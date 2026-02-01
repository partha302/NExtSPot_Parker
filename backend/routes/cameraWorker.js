const axios = require("axios");
const MjpegConsumer = require("mjpeg-consumer");
const { Buffer } = require("buffer");
const http = require("http");
const https = require("https");

// Map: spotId -> { camera, stopFn }
const cameraWorkers = new Map();

/**
 * Start camera worker for a parking spot
 */
function startCameraWorker({ spotId, cameraUrl, pythonServer, io }) {
  if (cameraWorkers.has(spotId)) {
    console.log(`⚠️ Camera worker already running for spot ${spotId}`);
    return;
  }

  console.log(`🎥 Starting camera worker for spot ${spotId}`);
  console.log(`📹 Camera URL: ${cameraUrl}`);

  let running = true;
  let consecutiveErrors = 0;
  const MAX_RETRIES = 50;
  let frameCount = 0;
  let lastFpsTime = Date.now();
  let currentFps = 0;
  let request = null;

  // Create MJPEG consumer
  const camera = new MjpegConsumer();

  // Function to connect to camera stream
  const connectCamera = () => {
    try {
      const client = cameraUrl.startsWith("https") ? https : http;

      request = client.get(cameraUrl, (response) => {
        console.log(`✅ Connected to camera stream [spot ${spotId}]`);
        consecutiveErrors = 0; // Reset errors on successful connection
        response.pipe(camera);
      });

      request.on("error", (err) => {
        console.error(
          `❌ Camera connection error [spot ${spotId}]:`,
          err.message,
        );
        camera.emit("error", err);
      });
    } catch (err) {
      console.error(`❌ Camera connect failed [spot ${spotId}]:`, err.message);
      camera.emit("error", err);
    }
  };

  camera.on("data", async (frameBuffer) => {
    if (!running) return;

    try {
      // Convert buffer to base64
      const base64Frame = frameBuffer.toString("base64");

      // Send to Python AI server
      const response = await axios.post(
        `${pythonServer}/process-frame`,
        {
          spot_id: spotId,
          frame: base64Frame,
          timestamp: Date.now(),
        },
        { timeout: 5000 },
      );

      // Broadcast processed frame with annotations
      if (response.data.processed_frame) {
        io.to(`spot_${spotId}`).emit("processed_frame", {
          spot_id: spotId,
          frame: response.data.processed_frame,
          timestamp: response.data.timestamp,
        });
      }

      // Broadcast occupancy data
      if (response.data.occupancy) {
        io.to(`spot_${spotId}`).emit("occupancy_update", {
          spot_id: spotId,
          occupancy: response.data.occupancy,
          num_slots: response.data.num_slots,
        });
      }

      // If state changed, broadcast that too
      if (response.data.state_change) {
        io.to(`spot_${spotId}`).emit("state_change", {
          spot_id: spotId,
          change: response.data.state_change,
        });
      }

      // Calculate FPS
      frameCount++;
      const now = Date.now();
      if (now - lastFpsTime >= 1000) {
        currentFps = frameCount;
        frameCount = 0;
        lastFpsTime = now;

        // Broadcast FPS
        io.to(`spot_${spotId}`).emit("fps_update", {
          spot_id: spotId,
          fps: currentFps,
        });
      }

      // Reset error counter on success
      consecutiveErrors = 0;
    } catch (err) {
      consecutiveErrors++;
      console.error(`❌ Frame processing error [spot ${spotId}]:`, err.message);

      if (consecutiveErrors > MAX_RETRIES) {
        console.error(`🛑 Too many errors for spot ${spotId}, stopping worker`);
        stopCameraWorker(spotId);

        // Notify clients
        io.to(`spot_${spotId}`).emit("camera_error", {
          spot_id: spotId,
          message: "Camera connection failed after multiple retries",
        });
      }
    }
  });

  camera.on("error", (err) => {
    console.error(`❌ Camera stream error [spot ${spotId}]:`, err.message);
    consecutiveErrors++;

    // Close existing request if any
    if (request) {
      request.destroy();
      request = null;
    }

    if (consecutiveErrors > MAX_RETRIES) {
      console.error(`🛑 Too many errors for spot ${spotId}, stopping worker`);
      stopCameraWorker(spotId);

      // Notify clients
      io.to(`spot_${spotId}`).emit("camera_error", {
        spot_id: spotId,
        message: "Camera stream error",
      });
    } else {
      // Exponential backoff reconnect
      const delay = Math.min(5000, 100 * consecutiveErrors);
      setTimeout(() => {
        if (running) {
          console.log(
            `🔄 Reconnecting to camera [spot ${spotId}] after ${delay}ms...`,
          );
          connectCamera();
        }
      }, delay);
    }
  });

  // Initial connection
  connectCamera();

  cameraWorkers.set(spotId, {
    camera,
    request,
    stopFn: () => {
      console.log(`⏹️ Stopping camera worker for spot ${spotId}`);
      running = false;
      camera.removeAllListeners();
      if (request) {
        request.destroy();
      }
    },
  });

  console.log(`✅ Camera worker started for spot ${spotId}`);
}

function stopCameraWorker(spotId) {
  const worker = cameraWorkers.get(spotId);
  if (worker) {
    worker.stopFn();
    cameraWorkers.delete(spotId);
    console.log(`✅ Camera worker stopped for spot ${spotId}`);
  }
}

function getWorkerStatus(spotId) {
  return cameraWorkers.has(spotId);
}

module.exports = {
  startCameraWorker,
  stopCameraWorker,
  getWorkerStatus,
};
