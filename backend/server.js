require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const axios = require("axios");
const mysql = require("mysql2");

// --- Basic setup ---
const app = express();
app.use(cors());
// Increase JSON payload limit for image uploads (base64 encoded images can be large)
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// --- Routes (make sure these paths exist) ---
const authRoutes = require("./routes/auth");
const spotsRoutes = require("./routes/spots");
const bookingsRoutes = require("./routes/bookings");
const systemRoutes = require("./routes/system");
const reviewsRouter = require("./routes/reviews");
const slotsRoutes = require("./routes/slots");
const aiRoutes = require("./routes/ai");

app.use("/api/auth", authRoutes);
app.use("/api/spots", spotsRoutes);
app.use("/api/bookings", bookingsRoutes);
app.use("/api/system", systemRoutes);
app.use("/reviews", reviewsRouter);
app.use("/api/slots", slotsRoutes);
app.use("/api/ai", aiRoutes);

app.get("/", (req, res) => res.send("Parking System API is running"));

// --- Database (mysql2 pool) ---
const db = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "parking_db",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Export db for other modules
module.exports.db = db;

// --- Active sessions store (shared) ---
const activeSessions = require("./activeSessions");

// --- HTTP + Socket.IO server creation ---
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 10e6, // 10 MB - adjust if needed
});

// --- Helper: update DB after detection ---
function updateSlotInDatabase(spot_id, slot_id, status, confidence) {
  const is_available = status === "vacant" ? 1 : 0;

  db.query(
    "UPDATE parking_slots SET is_available = ? WHERE id = ?",
    [is_available, slot_id],
    (err) => {
      if (err) {
        console.error("❌ DB update error:", err);
        return;
      }

      // Update spot statistics
      db.query(
        `UPDATE parking_spots 
         SET available_slots = (
           SELECT COUNT(*) FROM parking_slots 
           WHERE parking_spot_id = ? AND is_active = 1 AND is_available = 1
         ),
         occupied_slots = (
           SELECT COUNT(*) FROM parking_slots 
           WHERE parking_spot_id = ? AND is_active = 1 AND is_available = 0
         )
         WHERE id = ?`,
        [spot_id, spot_id, spot_id],
        (err2) => {
          if (err2) console.error("⚠️ Stats update error:", err2);
        },
      );

      // Log detection
      db.query(
        `INSERT INTO ai_detection_logs 
         (parking_spot_id, slot_id, detection_type, confidence, created_at) 
         VALUES (?, ?, ?, ?, NOW())`,
        [spot_id, slot_id, status, confidence],
        (err3) => {
          if (err3) console.error("⚠️ Log error:", err3);
        },
      );
    },
  );
}

// --- Socket.IO logic ---
function setupSocketIO(ioInstance, activeSessionsMap) {
  const PYTHON_AI_SERVER =
    process.env.PYTHON_AI_SERVER || "http://localhost:5001";

  ioInstance.on("connection", (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`);

    // Receive video frame from frontend
    socket.on("video_frame", async (data) => {
      try {
        const { spot_id, frame, timestamp, use_ai } = data;

        if (!spot_id) {
          socket.emit("error", { message: "Missing spot_id" });
          return;
        }

        if (!activeSessionsMap.has(spot_id)) {
          socket.emit("error", { message: "No active detection session" });
          return;
        }

        // Accept either raw base64 string or binary buffer or Uint8Array
        let base64Frame;
        if (typeof frame === "string") {
          if (frame.startsWith("data:")) {
            base64Frame = frame.split(",")[1];
          } else {
            base64Frame = frame;
          }
        } else if (Buffer.isBuffer(frame)) {
          base64Frame = frame.toString("base64");
        } else if (frame && frame.data && Array.isArray(frame.data)) {
          base64Frame = Buffer.from(frame.data).toString("base64");
        } else {
          socket.emit("error", { message: "Unsupported frame format" });
          return;
        }

        // Forward frame to Python AI server with use_ai flag
        const response = await axios.post(
          `${PYTHON_AI_SERVER}/process-frame`,
          {
            spot_id,
            frame: base64Frame,
            timestamp,
            use_ai: use_ai !== false, // Default to true if not specified
          },
          {
            headers: { "Content-Type": "application/json" },
            timeout: 10000,
          },
        );

        const {
          processed_frame,
          occupancy,
          state_change,
          frame_count,
          num_slots,
        } = response.data || {};

        // Always emit processed frame if available (for live visualization)
        if (processed_frame) {
          socket.emit("ai_processed_frame", {
            spot_id,
            processed_frame,
            frame_count,
            num_slots,
          });
        }

        // Handle state changes
        if (state_change) {
          const session = activeSessionsMap.get(spot_id);
          const changedSlot = state_change.slot_number;
          const oldStatus = state_change.old_status;
          const newStatus = state_change.new_status;

          const mappedSlotId =
            session && session.slot_mapping
              ? session.slot_mapping[String(changedSlot)]
              : null;

          if (mappedSlotId == null) {
            console.warn(
              `⚠️ No slot mapping for changedSlot ${changedSlot} on spot ${spot_id}`,
            );
          } else {
            const confidence =
              (occupancy &&
                occupancy.slots &&
                occupancy.slots[String(changedSlot)] &&
                occupancy.slots[String(changedSlot)].confidence) ||
              0;

            updateSlotInDatabase(spot_id, mappedSlotId, newStatus, confidence);
          }

          socket.emit("occupancy_update", {
            spot_id,
            changed_slot: changedSlot,
            old_status: oldStatus,
            new_status: newStatus,
            occupancy,
          });

          console.log(
            `🔄 Slot ${changedSlot}: ${oldStatus} → ${newStatus} (spot ${spot_id}, confidence: ${
              (occupancy &&
                occupancy.slots &&
                occupancy.slots[String(changedSlot)] &&
                occupancy.slots[String(changedSlot)].confidence) ||
              0
            })`,
          );
        }
      } catch (error) {
        console.error(
          "❌ Frame processing error:",
          error?.response?.data || error.message || error,
        );
        socket.emit("error", { message: "Frame processing failed" });
      }
    });

    socket.on("disconnect", () => {
      console.log(`🔌 Client disconnected: ${socket.id}`);
    });
  });
}

// Start Socket.IO handling
setupSocketIO(io, activeSessions);

// --- Exports (if other modules should interact) ---
module.exports = {
  setupSocketIO,
  activeSessions,
  io,
  db,
};

// --- Start server ---
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
