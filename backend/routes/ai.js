// backend/routes/ai.js - Integrated with Python AI Server (chalja.py)
const express = require("express");
const router = express.Router();
const db = require("../config/db");
const auth = require("../middleware/authMiddleware");
const axios = require("axios");

// Use the shared activeSessions map so server sockets and routes share the same state
const activeSessions = require("../activeSessions");

const PYTHON_AI_SERVER =
  process.env.PYTHON_AI_SERVER || "http://localhost:5001";

// Health check for Python AI server
router.get("/python-health", auth(["owner"]), async (req, res) => {
  try {
    const response = await axios.get(`${PYTHON_AI_SERVER}/health`, {
      timeout: 5000,
    });
    res.json({
      success: true,
      python_server: response.data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Python AI server not reachable",
      error: error.message,
    });
  }
});

// Toggle AI Mode
router.post("/toggle-mode/:spot_id", auth(["owner"]), (req, res) => {
  const { spot_id } = req.params;
  const { mode } = req.body;

  db.query(
    "SELECT owner_id, occupied_slots FROM parking_spots WHERE id = ?",
    [spot_id],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!result[0])
        return res.status(404).json({ message: "Spot not found" });
      if (result[0].owner_id !== req.user.id) {
        return res.status(403).json({ message: "Not authorized" });
      }

      if (mode === "ai" && result[0].occupied_slots > 0) {
        return res.status(400).json({
          message: "Cannot switch to AI mode while slots are occupied",
        });
      }

      db.query(
        `INSERT INTO ai_camera_config (parking_spot_id, mode) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE mode = ?`,
        [spot_id, mode, mode],
        (err2) => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json({ message: `Switched to ${mode} mode`, mode });
        },
      );
    },
  );
});

// Save Grid Configuration
router.post("/save-grid-config/:spot_id", auth(["owner"]), (req, res) => {
  const { spot_id } = req.params;
  const { grid_config } = req.body;

  if (!grid_config || !Array.isArray(grid_config.cells)) {
    return res.status(400).json({ message: "Invalid grid_config" });
  }

  const gridJson = JSON.stringify(grid_config);
  db.query(
    `INSERT INTO ai_camera_config (parking_spot_id, grid_config, last_calibrated)
     VALUES (?, ?, NOW())
     ON DUPLICATE KEY UPDATE grid_config = ?, last_calibrated = NOW()`,
    [spot_id, gridJson, gridJson],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Grid configuration saved" });
    },
  );
});

// Detect Grid - Auto-detect parking grid from frame
router.post("/detect-grid", auth(["owner"]), async (req, res) => {
  const { frame, aoi } = req.body;

  if (!frame) {
    return res.status(400).json({
      success: false,
      message: "Missing frame data",
    });
  }

  try {
    const response = await axios.post(
      `${PYTHON_AI_SERVER}/detect-grid`,
      { frame, aoi },
      { timeout: 30000 },
    );

    if (response.data.success) {
      res.json({
        success: true,
        num_cells: response.data.num_cells,
        cells: response.data.cells,
        annotated_frame: response.data.annotated_frame,
      });
    } else {
      res.status(500).json({
        success: false,
        message: response.data.error || "Grid detection failed",
      });
    }
  } catch (error) {
    console.error("❌ Grid detection error:", error.message);
    res.status(500).json({
      success: false,
      message: "Cannot connect to Python AI server for grid detection",
      error: error.message,
    });
  }
});

// Start AI Detection - Initialize Python AI server
router.post("/start-detection", auth(["owner"]), async (req, res) => {
  const { parking_spot_id, grid_config, auto_detect_grid } = req.body;

  if (!parking_spot_id) {
    return res.status(400).json({
      success: false,
      message: "Missing parking_spot_id",
    });
  }

  try {
    // Fetch slot mapping from DB
    const slotsQuery = `SELECT id as slot_id, slot_number FROM parking_slots 
                        WHERE parking_spot_id = ? AND is_active = 1 
                        ORDER BY slot_number`;

    db.query(slotsQuery, [parking_spot_id], async (err, slots) => {
      if (err) {
        return res.status(500).json({ success: false, message: err.message });
      }

      const slot_mapping = {};
      slots.forEach((slot) => {
        slot_mapping[String(slot.slot_number)] = slot.slot_id;
      });

      // Initialize Python AI server
      try {
        const response = await axios.post(
          `${PYTHON_AI_SERVER}/start-detection`,
          {
            parking_spot_id,
            grid_config,
            slot_mapping,
            auto_detect_grid: auto_detect_grid !== false,
          },
          { timeout: 10000 },
        );

        if (response.data.success) {
          // Store session in shared activeSessions map (so socket handler sees it)
          activeSessions.set(parking_spot_id, {
            grid_config,
            slot_mapping,
            started_at: Date.now(),
            last_states: {},
            num_slots: response.data.num_slots,
          });

          console.log(
            `✅ Detection started for spot ${parking_spot_id} with ${response.data.num_slots} slots`,
          );
          res.json({
            success: true,
            message: "Detection started",
            session_id: parking_spot_id,
            num_slots: response.data.num_slots,
            auto_detect: response.data.auto_detect,
          });
        } else {
          res.status(500).json({
            success: false,
            message: response.data.message || "Python AI failed",
          });
        }
      } catch (pythonError) {
        console.error("❌ Python AI error:", pythonError.message);
        res.status(500).json({
          success: false,
          message: "Cannot connect to Python AI server",
          error: pythonError.message,
        });
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Stop AI Detection
router.post("/stop-detection", auth(["owner"]), async (req, res) => {
  const { parking_spot_id } = req.body;

  if (!parking_spot_id) {
    console.error("❌ Missing parking_spot_id in stop-detection request");
    return res.status(400).json({
      success: false,
      message: "Missing parking_spot_id",
    });
  }

  try {
    try {
      await axios.post(
        `${PYTHON_AI_SERVER}/stop-detection`,
        { parking_spot_id },
        { timeout: 5000 },
      );
      console.log(`✅ Python AI stopped for spot ${parking_spot_id}`);
    } catch (pythonError) {
      console.warn(
        `⚠️ Python AI stop failed (non-critical):`,
        pythonError.message,
      );
    }

    // remove from shared active sessions
    activeSessions.delete(parking_spot_id);
    console.log(`⏹️ Detection stopped for spot ${parking_spot_id}`);

    res.json({
      success: true,
      message: "Detection stopped",
    });
  } catch (error) {
    console.error("❌ Stop detection error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Get AI Status
router.get("/status/:spot_id", auth(["owner"]), (req, res) => {
  const { spot_id } = req.params;

  db.query(
    `SELECT ac.*, ass.is_running, ass.fps, ass.last_heartbeat
     FROM ai_camera_config ac
     LEFT JOIN ai_system_status ass ON ac.parking_spot_id = ass.parking_spot_id
     WHERE ac.parking_spot_id = ?`,
    [spot_id],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(result[0] || { mode: "manual" });
    },
  );
});

module.exports = router;
