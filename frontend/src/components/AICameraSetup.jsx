// AICameraSetup.jsx - New Design with Original Functionality
import React, { useState, useRef, useEffect } from "react";
import { Wifi, Play, Square, Edit3, Trash2, Save, Target } from "lucide-react";
import { io } from "socket.io-client";

function AICameraSetup({ spotId, totalSlots, onClose }) {
  const [mode, setMode] = useState("manual");
  const [cameraActive, setCameraActive] = useState(false);
  const [gridConfig, setGridConfig] = useState(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [occupancyStatus, setOccupancyStatus] = useState({});
  const [message, setMessage] = useState("");
  const [fps, setFps] = useState(0);
  const [ipUrl, setIpUrl] = useState("");

  // IP Modal state
  const [showIpModal, setShowIpModal] = useState(false);
  const [ipInputValue, setIpInputValue] = useState("");

  // Drawing state
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [drawnRectangles, setDrawnRectangles] = useState([]);
  const [currentRect, setCurrentRect] = useState(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // Frozen frame state
  const [isFrozen, setIsFrozen] = useState(false);
  const [frozenImage, setFrozenImage] = useState(null);
  const [originalFrozenImage, setOriginalFrozenImage] = useState(null);
  const [frozenDimensions, setFrozenDimensions] = useState({
    width: 0,
    height: 0,
    internalWidth: 0,
    internalHeight: 0,
    displayWidth: 0,
    displayHeight: 0,
  });

  // AOI (Area of Interest) state
  const [aoiMode, setAoiMode] = useState(false);
  const [aoiRect, setAoiRect] = useState(null);
  const [isDrawingAOI, setIsDrawingAOI] = useState(false);

  // Auto-detection state
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [useAI, setUseAI] = useState(true);

  // Corner adjustment state
  const [selectedSlotIndex, setSelectedSlotIndex] = useState(null);
  const [draggingCorner, setDraggingCorner] = useState(null);
  const [isAdjustMode, setIsAdjustMode] = useState(false);

  // Refs
  const droppedFramesRef = useRef(0);
  const [droppedFrames, setDroppedFrames] = useState(0);
  const isDetectingRef = useRef(false);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const drawingCanvasRef = useRef(null);
  const processedCanvasRef = useRef(null);
  const frozenCanvasRef = useRef(null);
  const frozenImageRef = useRef(null);
  const socketRef = useRef(null);
  const frameIntervalRef = useRef(null);
  const fpsCounterRef = useRef({ frames: 0, lastTime: Date.now() });

  const token = localStorage.getItem("token");
  const BACKEND_SERVER =
    process.env.REACT_APP_BACKEND_SERVER || "http://localhost:5000";

  // Mark that AI modal is open for this spot so reloads can detect it
  useEffect(() => {
    try {
      sessionStorage.setItem(`aiCamera_was_open_${spotId}`, "true");
    } catch (err) {
      /* ignore */
    }

    return () => {
      try {
        sessionStorage.removeItem(`aiCamera_was_open_${spotId}`);
      } catch (err) {
        /* ignore */
      }
    };
  }, [spotId]);

  // Hide scrollbars and prevent body scroll
  useEffect(() => {
    // Hide scrollbar for webkit browsers
    const style = document.createElement("style");
    style.textContent = `
      .ai-camera-setup-sidebar::-webkit-scrollbar {
        display: none;
      }
      body {
        overflow: hidden !important;
      }
    `;
    document.head.appendChild(style);

    // Store original body overflow
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.head.removeChild(style);
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  // Socket connection
  useEffect(() => {
    if (!socketRef.current) {
      socketRef.current = io(BACKEND_SERVER, {
        transports: ["polling", "websocket"],
        auth: { token },
      });

      socketRef.current.on("connect", () => {
        setMessage("Connected to backend");
      });

      socketRef.current.on("error", (data) => {
        setMessage(`❌ ${data.message}`);
      });
    }

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, []);

  // Socket event handlers
  useEffect(() => {
    if (!socketRef.current) return;

    const handleProcessedFrame = (data) => {
      if (data.spot_id === spotId) {
        if (data.processed_frame) displayProcessedFrame(data.processed_frame);
        updateFPS();
      }
    };

    const handleOccupancyUpdate = (data) => {
      if (data.spot_id === spotId) {
        setOccupancyStatus(data.occupancy);
        setMessage(
          `🔄 Slot ${data.changed_slot}: ${data.old_status} → ${data.new_status}`,
        );
      }
    };

    socketRef.current.on("ai_processed_frame", handleProcessedFrame);
    socketRef.current.on("occupancy_update", handleOccupancyUpdate);

    return () => {
      if (socketRef.current) {
        socketRef.current.off("ai_processed_frame", handleProcessedFrame);
        socketRef.current.off("occupancy_update", handleOccupancyUpdate);
      }
    };
  }, [spotId]);

  // Resize and visibility handlers
  useEffect(() => {
    const handleResize = () => {
      if (isFrozen && frozenImageRef.current) {
        const img = frozenImageRef.current;
        setFrozenDimensions((prev) => ({
          ...prev,
          displayWidth: img.offsetWidth,
          displayHeight: img.offsetHeight,
        }));

        if (drawingCanvasRef.current && frozenDimensions.internalWidth > 0) {
          if (
            drawingCanvasRef.current.width !== frozenDimensions.internalWidth ||
            drawingCanvasRef.current.height !== frozenDimensions.internalHeight
          ) {
            drawingCanvasRef.current.width = frozenDimensions.internalWidth;
            drawingCanvasRef.current.height = frozenDimensions.internalHeight;
          }
          redrawRectangles();
        }
      } else {
        setupDrawingCanvas();
      }
    };

    const handleVisibilityChange = () => {
      if (
        !document.hidden &&
        drawingCanvasRef.current &&
        (drawnRectangles.length > 0 || aoiRect)
      ) {
        requestAnimationFrame(() => {
          if (
            isFrozen &&
            drawingCanvasRef.current &&
            frozenDimensions.internalWidth > 0
          ) {
            const w = frozenDimensions.internalWidth;
            const h = frozenDimensions.internalHeight;

            if (
              drawingCanvasRef.current.width !== w ||
              drawingCanvasRef.current.height !== h
            ) {
              drawingCanvasRef.current.width = w;
              drawingCanvasRef.current.height = h;
            }
          }
          redrawRectangles();
        });
      }
    };

    const handleFocus = () => {
      if (drawingCanvasRef.current && (drawnRectangles.length > 0 || aoiRect)) {
        requestAnimationFrame(() => {
          if (
            isFrozen &&
            drawingCanvasRef.current &&
            frozenDimensions.internalWidth > 0
          ) {
            const w = frozenDimensions.internalWidth;
            const h = frozenDimensions.internalHeight;

            if (
              drawingCanvasRef.current.width !== w ||
              drawingCanvasRef.current.height !== h
            ) {
              drawingCanvasRef.current.width = w;
              drawingCanvasRef.current.height = h;
            }
          }
          redrawRectangles();
        });
      }
    };

    window.addEventListener("resize", handleResize);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    return () => {
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [drawnRectangles, aoiRect, isFrozen, frozenDimensions]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopDetection();
      stopCamera();
    };
  }, []);

  // Redraw rectangles when state changes
  useEffect(() => {
    if (drawingCanvasRef.current && (drawnRectangles.length > 0 || aoiRect)) {
      redrawRectangles();
    }
  }, [drawnRectangles, aoiRect, isFrozen, frozenDimensions]);

  // --- CAMERA / STREAM HANDLING ---

  const startIPWebcam = () => {
    setIpInputValue("");
    setShowIpModal(true);
  };

  const handleIpSubmit = () => {
    const url = ipInputValue;
    if (!url) {
      setMessage("⚠️ Please enter a valid IP address");
      return;
    }

    let fullUrl = url.trim();

    if (!fullUrl.startsWith("http://") && !fullUrl.startsWith("https://")) {
      fullUrl = "http://" + fullUrl;
    }

    fullUrl = fullUrl.replace(/\/+$/, "");

    if (!/\/video(?:\b|$)/i.test(fullUrl)) {
      fullUrl = fullUrl + "/video";
    }

    console.log("📹 Connecting to:", fullUrl);

    setIpUrl(fullUrl);
    setCameraActive(true);
    setShowIpModal(false);
    setMessage("📹 Connecting to IP Webcam...");
    // Minimal persistence removed — keep sessionStorage flag elsewhere
    setTimeout(() => {
      try {
        updateLocalStorage();
      } catch (err) {
        // ignore
      }
    }, 120);
  };

  const stopCamera = () => {
    if (videoRef.current) {
      try {
        videoRef.current.src = "";
      } catch (e) {}
      videoRef.current = null;
    }
    setCameraActive(false);
    setIpUrl("");
    setIsFrozen(false);
    setFrozenImage(null);
    setIsDrawingMode(false);
    setAoiMode(false);
    setAoiRect(null);
    setMessage("📹 Camera stopped");
  };

  const setupDrawingCanvas = (imgElement = null) => {
    const canvas = drawingCanvasRef.current;
    if (!canvas) {
      console.log("⚠️ Drawing canvas ref not ready yet");
      return;
    }

    if (isFrozen && frozenCanvasRef.current) {
      const w = frozenCanvasRef.current.width;
      const h = frozenCanvasRef.current.height;
      canvas.width = w;
      canvas.height = h;

      if (drawnRectangles.length > 0 || aoiRect) {
        redrawRectangles();
      }
      return;
    }

    const img = imgElement || videoRef.current;
    if (!img) {
      console.log("⚠️ Video ref not ready yet");
      return;
    }

    const w = img.naturalWidth || img.width || 0;
    const h = img.naturalHeight || img.height || 0;

    if (w === 0 || h === 0 || (w === 300 && h === 150)) {
      console.log("⏳ Waiting for valid image dimensions, retrying...", {
        w,
        h,
      });
      setTimeout(() => setupDrawingCanvas(img), 100);
      return;
    }

    console.log("Setting up canvas with dimensions:", { w, h });

    canvas.width = w;
    canvas.height = h;
    if (canvasRef.current) {
      canvasRef.current.width = w;
      canvasRef.current.height = h;
    }
    if (frozenCanvasRef.current) {
      frozenCanvasRef.current.width = w;
      frozenCanvasRef.current.height = h;
    }
    if (processedCanvasRef.current) {
      processedCanvasRef.current.width = w;
      processedCanvasRef.current.height = h;
    }

    if (drawnRectangles.length > 0 || aoiRect) {
      redrawRectangles();
    }
  };

  const freezeFrame = () => {
    const img = videoRef.current;

    if (!img) {
      setMessage("⚠️ No image element available to freeze");
      return;
    }

    if (!img.complete || (img.naturalWidth || 0) === 0) {
      setMessage("⚠️ Wait for video to finish loading before freezing");
      return;
    }

    const w = img.naturalWidth || img.width || 1280;
    const h = img.naturalHeight || img.height || 720;

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = w;
    tempCanvas.height = h;
    const tempCtx = tempCanvas.getContext("2d");

    try {
      tempCtx.drawImage(img, 0, 0, w, h);

      let frozenDataUrl;
      try {
        frozenDataUrl = tempCanvas.toDataURL("image/jpeg", 0.95);
      } catch (securityErr) {
        console.error("CORS/tainted-canvas error:", securityErr);
        setMessage(
          "Cannot freeze frame: remote stream blocks cross-origin canvas access.",
        );
        return;
      }

      console.log("📸 Freezing frame with dimensions:", { w, h });

      setFrozenImage(frozenDataUrl);
      setOriginalFrozenImage(frozenDataUrl);
      setFrozenDimensions({
        width: w,
        height: h,
        internalWidth: w,
        internalHeight: h,
      });

      if (drawingCanvasRef.current) {
        drawingCanvasRef.current.width = w;
        drawingCanvasRef.current.height = h;
        console.log("📐 Drawing canvas set to:", { w, h });
      }

      setIsFrozen(true);
      setMessage(
        `📸 Frame frozen (${w}x${h}) - Now you can draw AOI or parking slots`,
      );

      // Save to localStorage after freezing
      setTimeout(() => updateLocalStorage(), 100);
    } catch (err) {
      console.error("Error freezing frame:", err);
      setMessage("Failed to freeze frame: " + (err.message || err));
    }
  };

  useEffect(() => {
    if (isFrozen && frozenImage && drawingCanvasRef.current) {
      const canvas = drawingCanvasRef.current;

      const w = frozenDimensions.internalWidth || 1280;
      const h = frozenDimensions.internalHeight || 720;

      canvas.width = w;
      canvas.height = h;

      console.log("📐 Drawing canvas setup via useEffect:", {
        internalW: canvas.width,
        internalH: canvas.height,
        displayW: canvas.offsetWidth,
        displayH: canvas.offsetHeight,
      });

      redrawRectangles();
    }
  }, [
    isFrozen,
    frozenImage,
    frozenDimensions.internalWidth,
    frozenDimensions.internalHeight,
  ]);

  const unfreezeFrame = () => {
    setIsDrawingMode(false);
    setIsDrawing(false);
    setCurrentRect(null);
    setIsDrawingAOI(false);

    setFrozenImage(null);
    setOriginalFrozenImage(null);
    setIsFrozen(false);

    setFrozenDimensions({
      width: 0,
      height: 0,
      internalWidth: 0,
      internalHeight: 0,
      displayWidth: 0,
      displayHeight: 0,
    });

    setMessage("▶️ Live feed resumed");
  };

  // Keep localStorage usage minimal — most autosave/persistence removed
  const updateLocalStorage = () => {
    // no-op: complex persistence removed to avoid memoization issues
  };

  // --- AOI DRAWING ---

  const startDrawingAOI = () => {
    if (!isFrozen) {
      setMessage("⚠️ Please freeze the frame first before drawing AOI");
      return;
    }

    setAoiMode(true);
    setIsDrawingMode(false);
    setMessage(
      "🎯 Draw Area of Interest (AOI) - Click and drag to define region",
    );
  };

  const clearAOI = () => {
    const canvas = drawingCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const currentWidth = canvas.width;
      const currentHeight = canvas.height;

      // Redraw only the parking slots without AOI
      drawnRectangles.forEach((rect, index) => {
        const isSelected = index === selectedSlotIndex;

        if (rect.corners && rect.corners.length === 4) {
          let corners = rect.corners;

          if (rect.corners_normalized) {
            corners = rect.corners_normalized.map((c) => ({
              x: c.x * currentWidth,
              y: c.y * currentHeight,
            }));
          }

          ctx.beginPath();
          ctx.moveTo(corners[0].x, corners[0].y);
          ctx.lineTo(corners[1].x, corners[1].y);
          ctx.lineTo(corners[2].x, corners[2].y);
          ctx.lineTo(corners[3].x, corners[3].y);
          ctx.closePath();

          ctx.fillStyle = isSelected
            ? "rgba(16, 185, 129, 0.2)"
            : "rgba(16, 185, 129, 0.1)";
          ctx.fill();

          ctx.strokeStyle = isSelected ? "#10B981" : "#10B981";
          ctx.lineWidth = isSelected ? 4 : 3;
          ctx.stroke();

          const centerX = corners.reduce((sum, c) => sum + c.x, 0) / 4;
          const centerY = corners.reduce((sum, c) => sum + c.y, 0) / 4;
          ctx.fillStyle = "#10B981";
          ctx.font = "bold 24px Arial";
          ctx.fillText(`#${index + 1}`, centerX - 15, centerY + 8);

          corners.forEach((corner, cornerIdx) => {
            const handleSize = isSelected ? 12 : 8;

            ctx.beginPath();
            ctx.arc(corner.x, corner.y, handleSize, 0, Math.PI * 2);
            ctx.fillStyle = isSelected ? "#FFFFFF" : "#FFFFFF";
            ctx.fill();
            ctx.strokeStyle = isSelected ? "#10B981" : "#6B7280";
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(corner.x, corner.y, handleSize - 4, 0, Math.PI * 2);
            ctx.fillStyle = isSelected ? "#10B981" : "#9CA3AF";
            ctx.fill();

            if (isSelected) {
              const labels = ["TL", "TR", "BR", "BL"];
              ctx.fillStyle = "#FFF";
              ctx.font = "bold 10px Arial";
              ctx.fillText(labels[cornerIdx], corner.x - 7, corner.y + 4);
            }
          });
        }
      });
    }

    setAoiRect(null);
    setAoiMode(false);
    setMessage("🗑️ AOI cleared");

    // Update localStorage
    updateLocalStorage();
  };

  // --- DRAWING / SLOTS ---

  const findClickedCorner = (x, y, threshold = 20) => {
    const canvas = drawingCanvasRef.current;
    const canvasWidth = canvas?.width || frozenDimensions.internalWidth || 1280;
    const canvasHeight =
      canvas?.height || frozenDimensions.internalHeight || 720;

    for (let slotIdx = 0; slotIdx < drawnRectangles.length; slotIdx++) {
      const slot = drawnRectangles[slotIdx];
      if (!slot.corners) continue;

      const corners = slot.corners_normalized
        ? slot.corners_normalized.map((c) => ({
            x: c.x * canvasWidth,
            y: c.y * canvasHeight,
          }))
        : slot.corners;

      for (let cornerIdx = 0; cornerIdx < corners.length; cornerIdx++) {
        const corner = corners[cornerIdx];
        const dist = Math.sqrt((x - corner.x) ** 2 + (y - corner.y) ** 2);
        if (dist <= threshold) {
          return { slotIdx, cornerIdx };
        }
      }
    }
    return null;
  };

  const isPointInQuad = (px, py, corners) => {
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return px >= minX && px <= maxX && py >= minY && py <= maxY;
  };

  const startDrawing = () => {
    if (drawnRectangles.length >= totalSlots) {
      setMessage(`⚠️ Maximum ${totalSlots} slots reached`);
      return;
    }
    if (!isFrozen) {
      setMessage("⚠️ Please freeze the frame first");
      return;
    }
    setIsDrawingMode(true);
    setAoiMode(false);
    setMessage("✏️ Click and drag to draw slot rectangle");
  };

  const handleCanvasMouseDown = (e) => {
    const { x, y } = getCanvasCoords(e);

    // Handle AOI drawing
    if (aoiMode) {
      setCurrentRect({ x1: x, y1: y, x2: x, y2: y });
      setIsDrawingAOI(true);
      return;
    }

    // Handle corner adjustment
    if (isAdjustMode && !isDrawingMode) {
      const clicked = findClickedCorner(x, y);
      if (clicked) {
        setSelectedSlotIndex(clicked.slotIdx);
        setDraggingCorner(clicked.cornerIdx);
        setMessage(
          `🎯 Dragging corner ${clicked.cornerIdx + 1} of slot ${clicked.slotIdx + 1}`,
        );
        return;
      }

      const canvas = drawingCanvasRef.current;
      const canvasWidth =
        canvas?.width || frozenDimensions.internalWidth || 1280;
      const canvasHeight =
        canvas?.height || frozenDimensions.internalHeight || 720;

      for (let slotIdx = 0; slotIdx < drawnRectangles.length; slotIdx++) {
        const slot = drawnRectangles[slotIdx];

        const corners = slot.corners_normalized
          ? slot.corners_normalized.map((c) => ({
              x: c.x * canvasWidth,
              y: c.y * canvasHeight,
            }))
          : slot.corners;

        if (corners && isPointInQuad(x, y, corners)) {
          setSelectedSlotIndex(slotIdx);
          setMessage(
            `📦 Selected slot ${slotIdx + 1} - Drag corners to adjust`,
          );
          redrawRectangles();
          return;
        }
      }
    }

    // Handle slot drawing
    if (!isDrawingMode) return;
    setCurrentRect({ x1: x, y1: y, x2: x, y2: y });
    setIsDrawing(true);
  };

  const handleCanvasMouseMove = (e) => {
    const { x, y } = getCanvasCoords(e);

    // Handle AOI drawing
    if (isDrawingAOI) {
      const newRect = { ...currentRect, x2: x, y2: y };
      setCurrentRect(newRect);
      redrawRectangles(drawnRectangles, newRect, true);
      return;
    }

    // Handle corner dragging
    if (draggingCorner !== null && selectedSlotIndex !== null) {
      const updatedRects = [...drawnRectangles];
      if (updatedRects[selectedSlotIndex]?.corners) {
        updatedRects[selectedSlotIndex].corners[draggingCorner] = { x, y };

        const canvas = drawingCanvasRef.current;
        const canvasWidth =
          canvas?.width || frozenDimensions.internalWidth || 1280;
        const canvasHeight =
          canvas?.height || frozenDimensions.internalHeight || 720;

        if (!updatedRects[selectedSlotIndex].corners_normalized) {
          updatedRects[selectedSlotIndex].corners_normalized = [];
        }
        updatedRects[selectedSlotIndex].corners_normalized[draggingCorner] = {
          x: x / canvasWidth,
          y: y / canvasHeight,
        };

        setDrawnRectangles(updatedRects);
        redrawRectangles(updatedRects);
        // Save to localStorage after corner adjustment
        setTimeout(() => updateLocalStorage(), 100);
      }
      return;
    }

    // Handle slot drawing
    if (!isDrawing || !currentRect) return;
    const newRect = { ...currentRect, x2: x, y2: y };
    setCurrentRect(newRect);
    redrawRectangles([...drawnRectangles, newRect]);
  };

  const handleCanvasMouseUp = (e) => {
    // Handle AOI drawing completion
    if (isDrawingAOI) {
      const { x, y } = getCanvasCoords(e);
      const finalRect = { ...currentRect, x2: x, y2: y };
      const width = Math.abs(finalRect.x2 - finalRect.x1);
      const height = Math.abs(finalRect.y2 - finalRect.y1);

      if (width > 50 && height > 50) {
        const x1 = Math.min(finalRect.x1, finalRect.x2);
        const y1 = Math.min(finalRect.y1, finalRect.y2);
        const x2 = Math.max(finalRect.x1, finalRect.x2);
        const y2 = Math.max(finalRect.y1, finalRect.y2);

        const canvas = drawingCanvasRef.current;
        const canvasWidth =
          canvas?.width || frozenDimensions.internalWidth || 1280;
        const canvasHeight =
          canvas?.height || frozenDimensions.internalHeight || 720;

        setAoiRect({
          x1,
          y1,
          x2,
          y2,
          x1_norm: x1 / canvasWidth,
          y1_norm: y1 / canvasHeight,
          x2_norm: x2 / canvasWidth,
          y2_norm: y2 / canvasHeight,
        });

        setMessage("AOI defined - Now use Auto-Detect or draw slots manually");
        setAoiMode(false);
        // Save to localStorage after AOI is set
        setTimeout(() => updateLocalStorage(), 100);
      } else {
        setMessage("⚠️ AOI too small - please draw a larger area");
      }

      setCurrentRect(null);
      setIsDrawingAOI(false);
      return;
    }

    // Handle corner dragging release
    if (draggingCorner !== null) {
      setDraggingCorner(null);
      setMessage(`Corner adjusted for slot ${selectedSlotIndex + 1}`);
      return;
    }

    // Handle slot drawing completion
    if (!isDrawing || !currentRect) return;
    const { x, y } = getCanvasCoords(e);
    const finalRect = { ...currentRect, x2: x, y2: y };
    const width = Math.abs(finalRect.x2 - finalRect.x1);
    const height = Math.abs(finalRect.y2 - finalRect.y1);

    if (width > 30 && height > 30) {
      const x1 = Math.min(finalRect.x1, finalRect.x2);
      const y1 = Math.min(finalRect.y1, finalRect.y2);
      const x2 = Math.max(finalRect.x1, finalRect.x2);
      const y2 = Math.max(finalRect.y1, finalRect.y2);

      const canvas = drawingCanvasRef.current;
      const canvasWidth =
        canvas?.width || frozenDimensions.internalWidth || 1280;
      const canvasHeight =
        canvas?.height || frozenDimensions.internalHeight || 720;

      const quadSlot = {
        corners: [
          { x: x1, y: y1 },
          { x: x2, y: y1 },
          { x: x2, y: y2 },
          { x: x1, y: y2 },
        ],
        corners_normalized: [
          { x: x1 / canvasWidth, y: y1 / canvasHeight },
          { x: x2 / canvasWidth, y: y1 / canvasHeight },
          { x: x2 / canvasWidth, y: y2 / canvasHeight },
          { x: x1 / canvasWidth, y: y2 / canvasHeight },
        ],
      };

      const newRects = [...drawnRectangles, quadSlot];
      setDrawnRectangles(newRects);
      setSelectedSlotIndex(newRects.length - 1);
      setIsAdjustMode(true);
      setMessage(
        `Slot ${newRects.length} drawn - Drag corners to adjust for perspective`,
      );
      setIsDrawingMode(false);
      // Save to localStorage after drawing slot
      setTimeout(() => updateLocalStorage(), 100);
    } else {
      setMessage("⚠️ Rectangle too small");
      setIsDrawingMode(false);
    }

    setCurrentRect(null);
    setIsDrawing(false);
  };

  const getCanvasCoords = (e) => {
    const canvas = drawingCanvasRef.current;

    const rect = canvas.getBoundingClientRect();

    const internalWidth = frozenDimensions.internalWidth || canvas.width;
    const internalHeight = frozenDimensions.internalHeight || canvas.height;

    const scaleX = internalWidth / rect.width;
    const scaleY = internalHeight / rect.height;

    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const redrawRectangles = (
    rects = drawnRectangles,
    tempRect = currentRect,
    isAOI = false,
  ) => {
    const canvas = drawingCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const currentWidth = canvas.width;
    const currentHeight = canvas.height;

    // Draw AOI first (if exists)
    if (aoiRect) {
      const { x1, y1, x2, y2 } = aoiRect;

      // Darken area outside AOI
      ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
      ctx.fillRect(0, 0, currentWidth, y1); // Top
      ctx.fillRect(0, y1, x1, y2 - y1); // Left
      ctx.fillRect(x2, y1, currentWidth - x2, y2 - y1); // Right
      ctx.fillRect(0, y2, currentWidth, currentHeight - y2); // Bottom

      // Draw AOI border
      ctx.strokeStyle = "#FFFF00"; // Yellow
      ctx.lineWidth = 4;
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

      // Draw AOI label
      ctx.fillStyle = "#FFFF00";
      ctx.font = "bold 20px Arial";
      ctx.fillText("AOI", x1 + 10, y1 + 30);
    }

    // Draw parking slots
    rects.forEach((rect, index) => {
      const isSelected = index === selectedSlotIndex;

      if (rect.corners && rect.corners.length === 4) {
        let corners = rect.corners;

        if (rect.corners_normalized) {
          corners = rect.corners_normalized.map((c) => ({
            x: c.x * currentWidth,
            y: c.y * currentHeight,
          }));
        }

        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        ctx.lineTo(corners[1].x, corners[1].y);
        ctx.lineTo(corners[2].x, corners[2].y);
        ctx.lineTo(corners[3].x, corners[3].y);
        ctx.closePath();

        ctx.fillStyle = isSelected
          ? "rgba(16, 185, 129, 0.2)"
          : "rgba(16, 185, 129, 0.1)";
        ctx.fill();

        ctx.strokeStyle = isSelected ? "#10B981" : "#10B981";
        ctx.lineWidth = isSelected ? 4 : 3;
        ctx.stroke();

        const centerX = corners.reduce((sum, c) => sum + c.x, 0) / 4;
        const centerY = corners.reduce((sum, c) => sum + c.y, 0) / 4;
        ctx.fillStyle = "#10B981";
        ctx.font = "bold 24px Arial";
        ctx.fillText(`#${index + 1}`, centerX - 15, centerY + 8);

        corners.forEach((corner, cornerIdx) => {
          const handleSize = isSelected ? 12 : 8;

          ctx.beginPath();
          ctx.arc(corner.x, corner.y, handleSize, 0, Math.PI * 2);
          ctx.fillStyle = isSelected ? "#FFFFFF" : "#FFFFFF";
          ctx.fill();
          ctx.strokeStyle = isSelected ? "#10B981" : "#6B7280";
          ctx.lineWidth = 2;
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(corner.x, corner.y, handleSize - 4, 0, Math.PI * 2);
          ctx.fillStyle = isSelected ? "#10B981" : "#9CA3AF";
          ctx.fill();

          if (isSelected) {
            const labels = ["TL", "TR", "BR", "BL"];
            ctx.fillStyle = "#FFF";
            ctx.font = "bold 10px Arial";
            ctx.fillText(labels[cornerIdx], corner.x - 7, corner.y + 4);
          }
        });
      }
    });

    // Draw temporary rectangle (for slot or AOI being drawn)
    if (tempRect) {
      const x = Math.min(tempRect.x1, tempRect.x2);
      const y = Math.min(tempRect.y1, tempRect.y2);
      const w = Math.abs(tempRect.x2 - tempRect.x1);
      const h = Math.abs(tempRect.y2 - tempRect.y1);

      ctx.strokeStyle = isAOI ? "#FFFF00" : "#F59E0B";
      ctx.lineWidth = isAOI ? 4 : 2;
      ctx.strokeRect(x, y, w, h);

      if (isAOI) {
        ctx.fillStyle = "rgba(255, 255, 0, 0.1)";
        ctx.fillRect(x, y, w, h);
      }
    }
  };

  const deleteLastRectangle = () => {
    if (drawnRectangles.length === 0) return;
    const updated = drawnRectangles.slice(0, -1);
    setDrawnRectangles(updated);
    redrawRectangles(updated);
    setMessage(`🗑️ Deleted slot ${drawnRectangles.length}`);
    // Save to localStorage after deletion
    updateLocalStorage();
  };

  const clearAllRectangles = () => {
    // Restore original frozen image if it exists
    if (originalFrozenImage) {
      setFrozenImage(originalFrozenImage);
    }

    const canvas = drawingCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Redraw only AOI if it exists
      if (aoiRect) {
        const { x1, y1, x2, y2 } = aoiRect;
        const currentWidth = canvas.width;
        const currentHeight = canvas.height;

        // Darken area outside AOI
        ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
        ctx.fillRect(0, 0, currentWidth, y1);
        ctx.fillRect(0, y1, x1, y2 - y1);
        ctx.fillRect(x2, y1, currentWidth - x2, y2 - y1);
        ctx.fillRect(0, y2, currentWidth, currentHeight - y2);

        // Draw AOI border
        ctx.strokeStyle = "#FFFF00";
        ctx.lineWidth = 4;
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

        ctx.fillStyle = "#FFFF00";
        ctx.font = "bold 20px Arial";
        ctx.fillText("AOI", x1 + 10, y1 + 30);
      }
    }

    setDrawnRectangles([]);
    setGridConfig(null);
    setSelectedSlotIndex(null);
    setIsAdjustMode(false);
    setMessage("🗑️ All slots cleared");

    // Update localStorage
    updateLocalStorage();
  };

  // --- AUTO-DETECT GRID ---

  const autoDetectGrid = async () => {
    if (!cameraActive || !isFrozen) {
      setMessage("⚠️ Please freeze the frame first");
      return;
    }

    setAutoDetecting(true);
    setMessage("🔍 Auto-detecting parking grid with YOLO...");

    try {
      const canvas = canvasRef.current;

      if (!originalFrozenImage && !frozenImage) {
        setMessage("No frozen frame available");
        setAutoDetecting(false);
        return;
      }

      // Create an image element from the frozen frame
      const img = new Image();
      img.src = originalFrozenImage || frozenImage;

      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      const origW = img.naturalWidth || img.width || 1280;
      const origH = img.naturalHeight || img.height || 720;

      const maxSize = 1280;
      let w = origW;
      let h = origH;
      if (w > maxSize || h > maxSize) {
        if (w > h) {
          h = Math.round((h / w) * maxSize);
          w = maxSize;
        } else {
          w = Math.round((w / h) * maxSize);
          h = maxSize;
        }
      }

      canvas.width = w;
      canvas.height = h;

      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);

      const base64Frame = canvas.toDataURL("image/jpeg", 0.8).split(",")[1];

      console.log(
        "📤 Auto-detect payload size:",
        Math.round(base64Frame.length / 1024),
        "KB",
      );

      const requestBody = {
        frame: base64Frame,
      };

      if (aoiRect) {
        requestBody.aoi = {
          bbox: [aoiRect.x1, aoiRect.y1, aoiRect.x2, aoiRect.y2],
          bbox_normalized: [
            aoiRect.x1_norm,
            aoiRect.y1_norm,
            aoiRect.x2_norm,
            aoiRect.y2_norm,
          ],
        };
        console.log("🎯 Sending AOI to backend:", requestBody.aoi);
      }

      const res = await fetch(`${BACKEND_SERVER}/api/ai/detect-grid`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(requestBody),
      });

      const result = await res.json();

      if (result.success && result.cells && result.cells.length > 0) {
        setMessage(`Auto-detected ${result.num_cells} parking slots`);

        const rects = result.cells.map((cell) => {
          const [x1, y1, x2, y2] = cell.bbox;
          const [x1_norm, y1_norm, x2_norm, y2_norm] = cell.bbox_normalized;

          return {
            corners: [
              { x: x1, y: y1 },
              { x: x2, y: y1 },
              { x: x2, y: y2 },
              { x: x1, y: y2 },
            ],
            corners_normalized: [
              { x: x1_norm, y: y1_norm },
              { x: x2_norm, y: y1_norm },
              { x: x2_norm, y: y2_norm },
              { x: x1_norm, y: y2_norm },
            ],
          };
        });

        setDrawnRectangles(rects);

        if (result.annotated_frame) {
          // Only set annotated frame if we don't have original stored
          if (!originalFrozenImage) {
            setOriginalFrozenImage(frozenImage);
          }
          setFrozenImage(result.annotated_frame);
        }

        const cfg = {
          spot_id: spotId,
          cells: result.cells,
          frame_width: result.frame_width,
          frame_height: result.frame_height,
          detected_at: Math.floor(Date.now() / 1000),
          auto_detected: true,
        };

        if (aoiRect) {
          cfg.aoi = {
            bbox: [aoiRect.x1, aoiRect.y1, aoiRect.x2, aoiRect.y2],
            bbox_normalized: [
              aoiRect.x1_norm,
              aoiRect.y1_norm,
              aoiRect.x2_norm,
              aoiRect.y2_norm,
            ],
          };
        }

        setGridConfig(cfg);

        redrawRectangles(rects);
      } else {
        setMessage(
          `Could not detect parking grid. ${result.message || "Draw manually instead."}`,
        );
      }
    } catch (err) {
      console.error("Auto-detect error:", err);
      setMessage(`Auto-detect failed: ${err.message}`);
    } finally {
      setAutoDetecting(false);
    }
  };

  // --- API / Backend interactions ---

  const saveGridConfiguration = async () => {
    console.log("🔵 Save Grid clicked", {
      drawnRectangles: drawnRectangles.length,
      totalSlots,
    });

    if (drawnRectangles.length === 0) {
      setMessage(`⚠️ Please draw at least one slot before saving`);
      return;
    }

    const frameWidth =
      isFrozen && frozenDimensions.internalWidth > 0
        ? frozenDimensions.internalWidth
        : drawingCanvasRef.current?.width ||
          videoRef.current?.naturalWidth ||
          1280;

    const frameHeight =
      isFrozen && frozenDimensions.internalHeight > 0
        ? frozenDimensions.internalHeight
        : drawingCanvasRef.current?.height ||
          videoRef.current?.naturalHeight ||
          720;

    console.log("📐 Grid reference dimensions:", {
      isFrozen,
      frozenDimensions_internal: {
        w: frozenDimensions.internalWidth,
        h: frozenDimensions.internalHeight,
      },
      drawingCanvas: {
        w: drawingCanvasRef.current?.width,
        h: drawingCanvasRef.current?.height,
      },
      videoNatural: {
        w: videoRef.current?.naturalWidth,
        h: videoRef.current?.naturalHeight,
      },
      using_width: frameWidth,
      using_height: frameHeight,
    });

    const cells = drawnRectangles
      .map((rect, index) => {
        if (rect.corners && rect.corners.length === 4) {
          const hasPrecomputedNormalized =
            rect.corners_normalized && rect.corners_normalized.length === 4;

          const corners = rect.corners;
          const xs = corners.map((c) => c.x);
          const ys = corners.map((c) => c.y);
          const x1_abs = Math.round(Math.min(...xs));
          const y1_abs = Math.round(Math.min(...ys));
          const x2_abs = Math.round(Math.max(...xs));
          const y2_abs = Math.round(Math.max(...ys));

          const corners_normalized = hasPrecomputedNormalized
            ? rect.corners_normalized
            : corners.map((c) => ({
                x: c.x / frameWidth,
                y: c.y / frameHeight,
              }));

          const bbox_normalized = hasPrecomputedNormalized
            ? [
                Math.min(...rect.corners_normalized.map((c) => c.x)),
                Math.min(...rect.corners_normalized.map((c) => c.y)),
                Math.max(...rect.corners_normalized.map((c) => c.x)),
                Math.max(...rect.corners_normalized.map((c) => c.y)),
              ]
            : [
                x1_abs / frameWidth,
                y1_abs / frameHeight,
                x2_abs / frameWidth,
                y2_abs / frameHeight,
              ];

          console.log(`📦 Slot ${index + 1}:`, {
            corners: corners,
            corners_normalized: corners_normalized,
            bbox: [x1_abs, y1_abs, x2_abs, y2_abs],
            bbox_normalized: bbox_normalized,
            usedPrecomputed: hasPrecomputedNormalized,
          });

          return {
            slot_number: index + 1,
            bbox: [x1_abs, y1_abs, x2_abs, y2_abs],
            bbox_normalized: bbox_normalized,
            corners: corners.map((c) => ({
              x: Math.round(c.x),
              y: Math.round(c.y),
            })),
            corners_normalized: corners_normalized,
          };
        }
        return null;
      })
      .filter((cell) => cell !== null);

    console.log("📦 First cell:", cells[0]);

    const cfg = {
      spot_id: spotId,
      cells,
      frame_width: frameWidth,
      frame_height: frameHeight,
      detected_at: Math.floor(Date.now() / 1000),
    };

    if (aoiRect) {
      cfg.aoi = {
        bbox: [aoiRect.x1, aoiRect.y1, aoiRect.x2, aoiRect.y2],
        bbox_normalized: [
          aoiRect.x1_norm,
          aoiRect.y1_norm,
          aoiRect.x2_norm,
          aoiRect.y2_norm,
        ],
      };
      console.log("🎯 Including AOI in config:", cfg.aoi);
    }

    setGridConfig(cfg);

    try {
      const res = await fetch(
        `${BACKEND_SERVER}/api/ai/save-grid-config/${spotId}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ grid_config: cfg }),
        },
      );

      console.log("📥 Response:", res.status, res.statusText);

      if (res.ok) {
        const data = await res.json();
        console.log("Grid saved successfully:", data);
        setMessage("Grid saved to backend - Ready to start detection!");

        // Save state to localStorage after successful save
        updateLocalStorage();
      } else {
        const errorText = await res.text();
        console.error("Save failed:", res.status, errorText);
        setMessage(`Failed to save grid: ${res.status}`);
      }
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
  };

  const startDetection = async (gridCfgParam = null) => {
    const cfg = gridCfgParam || gridConfig;
    if (!cfg) {
      setMessage("⚠️ Save grid configuration first");
      return;
    }

    try {
      const cfgToSend = cfg;
      const res = await fetch(`${BACKEND_SERVER}/api/ai/start-detection`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          parking_spot_id: spotId,
          grid_config: cfgToSend,
        }),
      });

      const result = await res.json();
      if (result.success) {
        setIsDetecting(true);
        isDetectingRef.current = true;
        const numFromCfg =
          (cfg && Array.isArray(cfg.cells) && cfg.cells.length) ||
          result.num_slots ||
          0;
        setMessage(`🚀 AI detection started with ${numFromCfg} slots`);

        setIsFrozen(false);
        setFrozenImage(null);

        setIsDrawingMode(false);
        setAoiMode(false);
        setIsAdjustMode(false);
        setSelectedSlotIndex(null);
        setDraggingCorner(null);

        setTimeout(() => {
          startFrameStream();
        }, 300);
      } else {
        setMessage(`${result.message}`);
      }
    } catch (err) {
      setMessage(`${err.message}`);
    }
  };

  const stopDetection = async () => {
    if (!isDetectingRef.current) {
      return;
    }

    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }

    setIsDetecting(false);
    isDetectingRef.current = false;
    setMessage("⏹️ Detection stopping...");

    setFps(0);
    setDroppedFrames(0);
    droppedFramesRef.current = 0;
    fpsCounterRef.current = { frames: 0, lastTime: Date.now() };

    try {
      const res = await fetch(`${BACKEND_SERVER}/api/ai/stop-detection`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ parking_spot_id: spotId }),
      });

      if (res.ok) {
        console.log("Detection stopped successfully");
        setMessage(
          "⏹️ Detection stopped - You can freeze frame and adjust grid",
        );
      } else {
        const errorText = await res.text();
        console.error("Stop detection failed:", errorText);
        setMessage("⚠️ Detection stopped (backend warning)");
      }
    } catch (err) {
      console.error("Stop detection error:", err);
      setMessage("⚠️ Detection stopped (connection error)");
    }
  };

  const startFrameStream = () => {
    if (frameIntervalRef.current) return;

    console.log("🎬 startFrameStream - setting up interval");

    let retryCount = 0;
    const maxRetries = 50;

    const checkVideoReady = () => {
      retryCount++;

      if (!isDetectingRef.current) {
        console.log("⏹️ Detection cancelled, stopping frame stream setup");
        return;
      }

      const img = videoRef.current;
      if (!img || !img.complete || (img.naturalWidth || 0) === 0) {
        if (retryCount >= maxRetries) {
          console.error("Video element never became ready after 5 seconds");
          setMessage("Video stream failed to load - try refreshing");
          return;
        }
        console.log(
          `⏳ Waiting for video element to be ready... (attempt ${retryCount}/${maxRetries})`,
        );
        setTimeout(checkVideoReady, 100);
        return;
      }

      console.log("Video ready, starting frame stream", {
        width: img.naturalWidth,
        height: img.naturalHeight,
      });

      startActualFrameStream();
    };

    checkVideoReady();
  };

  const startActualFrameStream = () => {
    if (frameIntervalRef.current) return;

    frameIntervalRef.current = setInterval(() => {
      if (!isDetectingRef.current) {
        if (frameIntervalRef.current) {
          clearInterval(frameIntervalRef.current);
          frameIntervalRef.current = null;
        }
        return;
      }

      const canvas = canvasRef.current;
      const img = videoRef.current;

      if (!canvas || !img) {
        droppedFramesRef.current++;
        if (droppedFramesRef.current % 5 === 0)
          setDroppedFrames(droppedFramesRef.current);
        return;
      }

      if (!img.complete || (img.naturalWidth || 0) === 0) {
        droppedFramesRef.current++;
        if (droppedFramesRef.current % 5 === 0)
          setDroppedFrames(droppedFramesRef.current);
        return;
      }

      const w = img.naturalWidth || 1280;
      const h = img.naturalHeight || 720;

      canvas.width = w;
      canvas.height = h;

      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, w, h);

      try {
        ctx.drawImage(img, 0, 0, w, h);
      } catch (err) {
        console.error("drawImage frame error:", err);
        return;
      }

      canvas.toBlob(
        (blob) => {
          if (!blob || !socketRef.current?.connected) {
            droppedFramesRef.current++;
            if (droppedFramesRef.current % 5 === 0) {
              setDroppedFrames(droppedFramesRef.current);
            }
            return;
          }

          socketRef.current.emit("video_frame", {
            spot_id: spotId,
            frame: blob,
            timestamp: Date.now(),
            use_ai: useAI,
          });
        },
        "image/jpeg",
        0.8,
      );
    }, 100);
  };

  const displayProcessedFrame = (base64Image) => {
    const canvas = processedCanvasRef.current;
    if (!canvas) {
      return;
    }

    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext("2d").drawImage(img, 0, 0);
    };
    img.src = base64Image.startsWith("data:")
      ? base64Image
      : `data:image/jpeg;base64,${base64Image}`;
  };

  const updateFPS = () => {
    fpsCounterRef.current.frames++;
    const now = Date.now();
    const elapsed = now - fpsCounterRef.current.lastTime;
    if (elapsed >= 1000) {
      setFps(fpsCounterRef.current.frames);
      fpsCounterRef.current.frames = 0;
      fpsCounterRef.current.lastTime = now;
    }
  };

  const toggleMode = async (newMode) => {
    try {
      const res = await fetch(
        `${BACKEND_SERVER}/api/ai/toggle-mode/${spotId}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ mode: newMode }),
        },
      );

      const data = await res.json();
      if (res.ok) {
        setMode(newMode);
        setMessage(`Switched to ${newMode} mode`);
      } else {
        setMessage(`${data.message}`);
      }
    } catch (err) {
      setMessage(`${err.message}`);
    }
  };

  const setImageRef = (el) => {
    videoRef.current = el;
    if (el) {
      console.log("📹 Video ref set:", {
        src: el.src ? el.src.substring(0, 50) + "..." : "none",
        complete: el.complete,
        naturalWidth: el.naturalWidth,
        naturalHeight: el.naturalHeight,
      });
    } else {
      console.log("📹 Video ref cleared (element unmounted)");
    }
  };

  // --- STYLES ---
  const styles = {
    container: {
      fontFamily:
        "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: "100vw",
      height: "100vh",
      display: "flex",
      flexDirection: "column",
      backgroundColor: "#f6f6f8",
      color: "#0d121b",
      overflow: "hidden",
      zIndex: 100,
    },
    header: {
      height: "64px",
      borderBottom: "1px solid #e7ebf3",
      backgroundColor: "#ffffff",
      padding: "0 24px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      flexShrink: 0,
      zIndex: 20,
      position: "relative",
      boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
    },
    headerLeft: {
      display: "flex",
      alignItems: "center",
      gap: "16px",
    },
    logoBox: {
      width: "32px",
      height: "32px",
      backgroundColor: "rgba(19, 91, 236, 0.1)",
      borderRadius: "8px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "#135bec",
      fontSize: "20px",
    },
    headerTitle: {
      fontSize: "18px",
      fontWeight: 700,
      letterSpacing: "-0.02em",
      margin: 0,
    },
    divider: {
      height: "24px",
      width: "1px",
      backgroundColor: "#e5e7eb",
      margin: "0 8px",
    },
    subtitle: {
      fontSize: "14px",
      color: "#6b7280",
      fontWeight: 500,
    },
    statusChips: {
      display: "flex",
      alignItems: "center",
      gap: "12px",
    },
    statusChip: {
      display: "flex",
      height: "32px",
      alignItems: "center",
      gap: "8px",
      borderRadius: "9999px",
      padding: "0 12px",
      fontSize: "12px",
      fontWeight: 600,
    },
    statusChipActive: {
      backgroundColor: "rgba(34, 197, 94, 0.1)",
      border: "1px solid rgba(34, 197, 94, 0.2)",
      color: "#15803d",
    },
    statusChipBlue: {
      backgroundColor: "rgba(59, 130, 246, 0.1)",
      border: "1px solid rgba(59, 130, 246, 0.2)",
      color: "#1d4ed8",
    },
    statusChipPurple: {
      backgroundColor: "rgba(168, 85, 247, 0.1)",
      border: "1px solid rgba(168, 85, 247, 0.2)",
      color: "#7e22ce",
    },
    statusChipRed: {
      backgroundColor: "rgba(239, 68, 68, 0.1)",
      border: "1px solid rgba(239, 68, 68, 0.2)",
      color: "#dc2626",
    },
    dot: {
      width: "8px",
      height: "8px",
      borderRadius: "50%",
      backgroundColor: "#22c55e",
    },
    dotRed: {
      width: "8px",
      height: "8px",
      borderRadius: "50%",
      backgroundColor: "#ef4444",
    },
    mainLayout: {
      display: "flex",
      flex: 1,
      overflow: "hidden",
    },
    sidebar: {
      width: "320px",
      backgroundColor: "#ffffff",
      borderRight: "1px solid #e7ebf3",
      display: "flex",
      flexDirection: "column",
      flexShrink: 0,
      overflowY: "auto",
      scrollbarWidth: "none",
      msOverflowStyle: "none",
    },
    sidebarContent: {
      padding: "24px",
    },
    sidebarTitle: {
      fontSize: "16px",
      fontWeight: 600,
      marginBottom: "4px",
    },
    sidebarDesc: {
      fontSize: "14px",
      color: "#6b7280",
      marginBottom: "24px",
    },
    modeSelector: {
      display: "flex",
      gap: "12px",
      marginBottom: "24px",
      padding: "12px",
      backgroundColor: "#f9fafb",
      borderRadius: "8px",
      border: "1px solid #e5e7eb",
    },
    modeButton: {
      flex: 1,
      padding: "10px 16px",
      borderRadius: "6px",
      border: "none",
      cursor: "pointer",
      fontSize: "14px",
      fontWeight: 600,
      transition: "all 0.2s",
    },
    modeButtonActive: {
      backgroundColor: "#135bec",
      color: "#ffffff",
    },
    modeButtonInactive: {
      backgroundColor: "#ffffff",
      color: "#6b7280",
      border: "1px solid #e5e7eb",
    },
    sectionTitle: {
      fontSize: "12px",
      fontWeight: 600,
      color: "#374151",
      marginBottom: "12px",
      textTransform: "uppercase",
      letterSpacing: "0.05em",
    },
    button: {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      padding: "10px 16px",
      borderRadius: "8px",
      border: "1px solid #e5e7eb",
      backgroundColor: "#ffffff",
      fontSize: "14px",
      fontWeight: 600,
      cursor: "pointer",
      transition: "all 0.2s",
      boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
      width: "100%",
      justifyContent: "center",
    },
    buttonPrimary: {
      backgroundColor: "#135bec",
      color: "#ffffff",
      border: "none",
      boxShadow: "0 4px 6px -1px rgba(19, 91, 236, 0.2)",
    },
    buttonSuccess: {
      backgroundColor: "#10B981",
      color: "#ffffff",
      border: "none",
    },
    buttonDanger: {
      backgroundColor: "#EF4444",
      color: "#ffffff",
      border: "none",
    },
    buttonWarning: {
      backgroundColor: "#F59E0B",
      color: "#ffffff",
      border: "none",
    },
    buttonPurple: {
      backgroundColor: "#8B5CF6",
      color: "#ffffff",
      border: "none",
    },
    buttonDisabled: {
      backgroundColor: "#E5E7EB",
      color: "#9CA3AF",
      cursor: "not-allowed",
      border: "none",
    },
    buttonGroup: {
      display: "flex",
      flexDirection: "column",
      gap: "8px",
      marginBottom: "16px",
    },
    buttonRow: {
      display: "flex",
      gap: "8px",
    },
    slotCounter: {
      padding: "12px",
      backgroundColor: "#f0fdf4",
      borderRadius: "8px",
      border: "1px solid #bbf7d0",
      marginBottom: "16px",
      textAlign: "center",
    },
    slotCounterText: {
      fontSize: "14px",
      fontWeight: 600,
      color: "#16a34a",
    },
    mainContent: {
      flex: 1,
      display: "flex",
      flexDirection: "column",
      minWidth: 0,
      backgroundColor: "#f6f6f8",
      position: "relative",
    },
    videoSection: {
      flex: 1,
      padding: "24px",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      position: "relative",
    },
    videoGrid: {
      display: "grid",
      gap: "20px",
      flex: 1,
      minHeight: 0,
    },
    videoContainer: {
      position: "relative",
      width: "100%",
      height: "100%",
      backgroundColor: "#000000",
      borderRadius: "12px",
      overflow: "hidden",
      boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
      border: "1px solid #e5e7eb",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    },
    videoLabel: {
      fontSize: "14px",
      fontWeight: 600,
      marginBottom: "8px",
      color: "#374151",
    },
    freezeButton: {
      position: "absolute",
      bottom: "16px",
      left: "16px",
      zIndex: 20,
      display: "flex",
      alignItems: "center",
      gap: "8px",
      backgroundColor: "rgba(0, 0, 0, 0.6)",
      backdropFilter: "blur(8px)",
      color: "#ffffff",
      padding: "8px 12px",
      borderRadius: "8px",
      border: "none",
      cursor: "pointer",
      fontSize: "12px",
      fontWeight: 500,
      transition: "background-color 0.2s",
    },
    tooltip: {
      position: "absolute",
      top: "16px",
      left: "50%",
      transform: "translateX(-50%)",
      backgroundColor: "rgba(0, 0, 0, 0.7)",
      backdropFilter: "blur(8px)",
      color: "#ffffff",
      padding: "8px 16px",
      borderRadius: "9999px",
      fontSize: "12px",
      fontWeight: 500,
      display: "flex",
      alignItems: "center",
      gap: "8px",
      boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
      zIndex: 20,
    },
    frozenBadge: {
      position: "absolute",
      top: "10px",
      right: "10px",
      backgroundColor: "rgba(59, 130, 246, 0.9)",
      color: "white",
      padding: "6px 12px",
      borderRadius: "4px",
      fontWeight: 600,
      fontSize: "14px",
      zIndex: 20,
    },
    occupancyGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
      gap: "8px",
      marginTop: "16px",
      padding: "16px",
      backgroundColor: "#ffffff",
      borderRadius: "8px",
      border: "1px solid #e5e7eb",
    },
    occupancyCard: {
      padding: "12px",
      borderRadius: "8px",
      textAlign: "center",
    },
    checkboxLabel: {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      padding: "8px 12px",
      backgroundColor: "#F3F4F6",
      borderRadius: "6px",
      cursor: "pointer",
      fontSize: "14px",
      fontWeight: 500,
    },
  };

  // --- RENDER ---
  return (
    <div style={styles.container}>
      {/* IP Address Modal */}
      {showIpModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setShowIpModal(false)}
        >
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "16px",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
              width: "100%",
              maxWidth: "440px",
              overflow: "hidden",
              animation: "fadeIn 0.2s ease-out",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: "20px 24px",
                borderBottom: "1px solid #e5e7eb",
                display: "flex",
                alignItems: "center",
                gap: "12px",
              }}
            >
              <div
                style={{
                  width: "44px",
                  height: "44px",
                  borderRadius: "12px",
                  backgroundColor: "rgba(19, 91, 236, 0.1)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "22px",
                }}
              >
                📹
              </div>
              <div>
                <h3
                  style={{
                    margin: 0,
                    fontSize: "18px",
                    fontWeight: 700,
                    color: "#0d121b",
                  }}
                >
                  Connect IP Webcam
                </h3>
                <p
                  style={{
                    margin: "2px 0 0 0",
                    fontSize: "14px",
                    color: "#6b7280",
                  }}
                >
                  Enter your camera's network address
                </p>
              </div>
            </div>

            {/* Modal Body */}
            <div style={{ padding: "24px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "14px",
                  fontWeight: 600,
                  color: "#374151",
                  marginBottom: "8px",
                }}
              >
                IP Webcam URL
              </label>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  border: "2px solid #e5e7eb",
                  borderRadius: "10px",
                  overflow: "hidden",
                  transition: "border-color 0.2s",
                  backgroundColor: "#f9fafb",
                }}
              >
                <span
                  style={{
                    padding: "12px 14px",
                    backgroundColor: "#f3f4f6",
                    color: "#6b7280",
                    fontSize: "14px",
                    fontWeight: 500,
                    borderRight: "1px solid #e5e7eb",
                  }}
                >
                  http://
                </span>
                <input
                  type="text"
                  value={ipInputValue}
                  onChange={(e) => setIpInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleIpSubmit();
                    if (e.key === "Escape") setShowIpModal(false);
                  }}
                  placeholder="192.168.1.100:8080"
                  autoFocus
                  style={{
                    flex: 1,
                    padding: "12px 14px",
                    border: "none",
                    outline: "none",
                    fontSize: "15px",
                    fontWeight: 500,
                    backgroundColor: "transparent",
                    color: "#0d121b",
                  }}
                />
              </div>
              <p
                style={{
                  margin: "10px 0 0 0",
                  fontSize: "13px",
                  color: "#9ca3af",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <span style={{ fontSize: "14px" }}>💡</span>
                Example: 192.168.1.100:8080 (the /video path is added
                automatically)
              </p>
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: "16px 24px",
                backgroundColor: "#f9fafb",
                borderTop: "1px solid #e5e7eb",
                display: "flex",
                justifyContent: "flex-end",
                gap: "12px",
              }}
            >
              <button
                onClick={() => setShowIpModal(false)}
                style={{
                  padding: "10px 20px",
                  borderRadius: "8px",
                  border: "1px solid #e5e7eb",
                  backgroundColor: "#ffffff",
                  color: "#374151",
                  fontSize: "14px",
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = "#f3f4f6";
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = "#ffffff";
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleIpSubmit}
                style={{
                  padding: "10px 24px",
                  borderRadius: "8px",
                  border: "none",
                  backgroundColor: "#135bec",
                  color: "#ffffff",
                  fontSize: "14px",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  boxShadow: "0 4px 6px -1px rgba(19, 91, 236, 0.3)",
                  transition: "all 0.2s",
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = "#1048c4";
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = "#135bec";
                }}
              >
                <Wifi size={16} />
                Connect
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.logoBox}>📹</div>
          <h1 style={styles.headerTitle}>AI Camera Setup</h1>
          <div style={styles.divider}></div>
          <span style={styles.subtitle}>
            Spot #{spotId} • {totalSlots} Slots
          </span>
        </div>

        <div style={styles.statusChips}>
          <div
            style={{
              ...styles.statusChip,
              ...(cameraActive
                ? styles.statusChipActive
                : styles.statusChipRed),
            }}
          >
            <div style={cameraActive ? styles.dot : styles.dotRed}></div>
            <span>{cameraActive ? "Connected" : "Disconnected"}</span>
          </div>
          {isDetecting && (
            <>
              <div style={{ ...styles.statusChip, ...styles.statusChipBlue }}>
                <span>⚡</span>
                <span>{fps} FPS</span>
              </div>
              {droppedFrames > 0 && (
                <div style={{ ...styles.statusChip, ...styles.statusChipRed }}>
                  <span>⚠️</span>
                  <span>Dropped: {droppedFrames}</span>
                </div>
              )}
            </>
          )}
          <div style={{ ...styles.statusChip, ...styles.statusChipPurple }}>
            <span>🧠</span>
            <span>YOLOv8</span>
          </div>
        </div>

        <button
          onClick={onClose}
          style={{
            padding: "8px 16px",
            background: "#EF4444",
            color: "white",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          ✕ Close
        </button>
      </header>

      <div style={styles.mainLayout}>
        {/* Sidebar */}
        <aside style={styles.sidebar} className="ai-camera-setup-sidebar">
          <div style={styles.sidebarContent}>
            <h2 style={styles.sidebarTitle}>Setup Wizard</h2>
            <p style={styles.sidebarDesc}>Configure your parking detection</p>

            {/* Mode Selector */}
            <div style={styles.modeSelector}>
              <button
                style={{
                  ...styles.modeButton,
                  ...(mode === "manual"
                    ? styles.modeButtonActive
                    : styles.modeButtonInactive),
                }}
                onClick={() => toggleMode("manual")}
                disabled={isDetecting}
              >
                Manual
              </button>
              <button
                style={{
                  ...styles.modeButton,
                  ...(mode === "ai"
                    ? styles.modeButtonActive
                    : styles.modeButtonInactive),
                }}
                onClick={() => toggleMode("ai")}
                disabled={isDetecting}
              >
                AI Mode
              </button>
            </div>

            {mode === "ai" && (
              <>
                {/* Camera Controls */}
                <div style={styles.sectionTitle}>📹 Camera Connection</div>
                <div style={styles.buttonGroup}>
                  <button
                    onClick={startIPWebcam}
                    disabled={cameraActive}
                    style={{
                      ...styles.button,
                      ...(cameraActive
                        ? styles.buttonDisabled
                        : styles.buttonSuccess),
                    }}
                  >
                    <Wifi size={16} /> Connect IP Webcam
                  </button>
                  {cameraActive && (
                    <button
                      onClick={stopCamera}
                      style={{ ...styles.button, ...styles.buttonDanger }}
                    >
                      <Square size={16} /> Stop Camera
                    </button>
                  )}
                </div>

                {cameraActive && !isDetecting && (
                  <>
                    {/* Freeze Controls */}
                    <div style={styles.sectionTitle}>📸 Frame Control</div>
                    <div style={styles.buttonGroup}>
                      <button
                        onClick={isFrozen ? unfreezeFrame : freezeFrame}
                        style={{
                          ...styles.button,
                          ...(isFrozen
                            ? styles.buttonSuccess
                            : styles.buttonPrimary),
                        }}
                      >
                        {isFrozen ? "▶️ Unfreeze" : "⏸️ Freeze Frame"}
                      </button>
                    </div>

                    {/* AOI Controls */}
                    <div style={styles.sectionTitle}>🎯 Area of Interest</div>
                    <div style={styles.buttonGroup}>
                      {!aoiRect ? (
                        <button
                          onClick={startDrawingAOI}
                          disabled={!isFrozen}
                          style={{
                            ...styles.button,
                            ...(!isFrozen
                              ? styles.buttonDisabled
                              : styles.buttonWarning),
                          }}
                        >
                          <Target size={16} /> Draw AOI
                        </button>
                      ) : (
                        <button
                          onClick={clearAOI}
                          style={{ ...styles.button, ...styles.buttonWarning }}
                        >
                          <Trash2 size={16} /> Clear AOI
                        </button>
                      )}
                    </div>

                    {/* Slot Drawing Controls */}
                    <div style={styles.sectionTitle}>🅿️ Parking Slots</div>
                    <div style={styles.slotCounter}>
                      <span style={styles.slotCounterText}>
                        {drawnRectangles.length} / {totalSlots} Slots Defined
                      </span>
                    </div>
                    <div style={styles.buttonGroup}>
                      <button
                        onClick={autoDetectGrid}
                        disabled={autoDetecting || !isFrozen}
                        style={{
                          ...styles.button,
                          ...(autoDetecting || !isFrozen
                            ? styles.buttonDisabled
                            : styles.buttonPurple),
                        }}
                      >
                        🤖 {autoDetecting ? "Detecting..." : "Auto-Detect Grid"}
                      </button>
                      <button
                        onClick={startDrawing}
                        disabled={
                          drawnRectangles.length >= totalSlots || !isFrozen
                        }
                        style={{
                          ...styles.button,
                          ...(drawnRectangles.length >= totalSlots || !isFrozen
                            ? styles.buttonDisabled
                            : styles.buttonPurple),
                        }}
                      >
                        <Edit3 size={16} /> Draw Slot
                      </button>
                      <button
                        onClick={() => {
                          setIsAdjustMode(!isAdjustMode);
                          if (!isAdjustMode && drawnRectangles.length > 0) {
                            setSelectedSlotIndex(0);
                            setMessage(
                              "🎯 Adjust Mode ON - Click slot to select, drag corners",
                            );
                          } else {
                            setSelectedSlotIndex(null);
                            setMessage("🔒 Adjust Mode OFF");
                          }
                          redrawRectangles();
                        }}
                        disabled={drawnRectangles.length === 0 || !isFrozen}
                        style={{
                          ...styles.button,
                          ...(drawnRectangles.length === 0 || !isFrozen
                            ? styles.buttonDisabled
                            : isAdjustMode
                              ? styles.buttonSuccess
                              : {
                                  backgroundColor: "#6366F1",
                                  color: "#fff",
                                  border: "none",
                                }),
                        }}
                      >
                        🎯 {isAdjustMode ? "Adjusting..." : "Adjust Corners"}
                      </button>
                      <div style={styles.buttonRow}>
                        <button
                          onClick={deleteLastRectangle}
                          disabled={drawnRectangles.length === 0}
                          style={{
                            ...styles.button,
                            flex: 1,
                            ...(drawnRectangles.length === 0
                              ? styles.buttonDisabled
                              : styles.buttonWarning),
                          }}
                        >
                          <Trash2 size={16} /> Undo
                        </button>
                        <button
                          onClick={clearAllRectangles}
                          disabled={drawnRectangles.length === 0}
                          style={{
                            ...styles.button,
                            flex: 1,
                            ...(drawnRectangles.length === 0
                              ? styles.buttonDisabled
                              : styles.buttonDanger),
                          }}
                        >
                          <Trash2 size={16} /> Clear
                        </button>
                      </div>
                    </div>

                    {/* Save Grid */}
                    <div style={styles.buttonGroup}>
                      <button
                        onClick={saveGridConfiguration}
                        disabled={drawnRectangles.length !== totalSlots}
                        style={{
                          ...styles.button,
                          ...(drawnRectangles.length !== totalSlots
                            ? styles.buttonDisabled
                            : styles.buttonSuccess),
                        }}
                      >
                        <Save size={16} /> Save Grid ({drawnRectangles.length}/
                        {totalSlots})
                      </button>
                    </div>
                  </>
                )}

                {/* Detection Controls */}
                {gridConfig && (
                  <>
                    <div style={styles.sectionTitle}>🚀 Detection</div>
                    <div style={styles.buttonGroup}>
                      <button
                        onClick={() => {
                          if (isDetecting) {
                            stopDetection();
                          } else {
                            startDetection();
                          }
                        }}
                        style={{
                          ...styles.button,
                          ...(isDetecting
                            ? styles.buttonDanger
                            : styles.buttonSuccess),
                        }}
                      >
                        {isDetecting ? (
                          <Square size={16} />
                        ) : (
                          <Play size={16} />
                        )}
                        {isDetecting ? "Stop Detection" : "Start Detection"}
                      </button>
                      {isDetecting && (
                        <label style={styles.checkboxLabel}>
                          <input
                            type="checkbox"
                            checked={useAI}
                            onChange={(e) => setUseAI(e.target.checked)}
                          />
                          <span>Use AI Detection</span>
                        </label>
                      )}
                    </div>
                  </>
                )}

                {!isFrozen && cameraActive && !isDetecting && (
                  <div
                    style={{
                      marginTop: "16px",
                      padding: "12px",
                      backgroundColor: "#FEF3C7",
                      borderRadius: "8px",
                      fontSize: "12px",
                      color: "#92400E",
                    }}
                  >
                    💡 Click "Freeze Frame" to hold the image steady for drawing
                  </div>
                )}
              </>
            )}
          </div>
        </aside>

        {/* Main Content */}
        <main style={styles.mainContent}>
          <div style={styles.videoSection}>
            {/* Message Alert Overlay */}
            {message && (
              <div
                style={{
                  position: "absolute",
                  top: "32px",
                  left: "50%",
                  transform: "translateX(-50%)",
                  zIndex: 100,
                  maxWidth: "calc(100% - 48px)",
                  width: "auto",
                  minWidth: "400px",
                  padding: "0",
                  borderRadius: "12px",
                  overflow: "hidden",
                  boxShadow:
                    "0 10px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.15)",
                  backgroundColor: message.includes("❌")
                    ? "#fef2f2"
                    : message.includes("⚠️")
                      ? "#fffbeb"
                      : message.includes("🔄") || message.includes("🔍")
                        ? "#eff6ff"
                        : "#f0fdf4",
                  border: `2px solid ${
                    message.includes("❌")
                      ? "#fecaca"
                      : message.includes("⚠️")
                        ? "#fde68a"
                        : message.includes("🔄") || message.includes("🔍")
                          ? "#bfdbfe"
                          : "#bbf7d0"
                  }`,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    padding: "14px 18px",
                  }}
                >
                  <div
                    style={{
                      width: "36px",
                      height: "36px",
                      borderRadius: "10px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      backgroundColor: message.includes("❌")
                        ? "#fee2e2"
                        : message.includes("⚠️")
                          ? "#fef3c7"
                          : message.includes("🔄") || message.includes("🔍")
                            ? "#dbeafe"
                            : "#dcfce7",
                      fontSize: "18px",
                    }}
                  >
                    {message.includes("❌")
                      ? "❌"
                      : message.includes("⚠️")
                        ? "⚠️"
                        : message.includes("🔄") || message.includes("🔍")
                          ? "🔄"
                          : "✅"}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: "13px",
                        fontWeight: 600,
                        marginBottom: "2px",
                        color: message.includes("❌")
                          ? "#b91c1c"
                          : message.includes("⚠️")
                            ? "#b45309"
                            : message.includes("🔄") || message.includes("🔍")
                              ? "#1d4ed8"
                              : "#15803d",
                      }}
                    >
                      {message.includes("❌")
                        ? "Error"
                        : message.includes("⚠️")
                          ? "Warning"
                          : message.includes("🔄") || message.includes("🔍")
                            ? "Processing"
                            : "Success"}
                    </div>
                    <div
                      style={{
                        fontSize: "14px",
                        fontWeight: 500,
                        color: message.includes("❌")
                          ? "#dc2626"
                          : message.includes("⚠️")
                            ? "#d97706"
                            : message.includes("🔄") || message.includes("🔍")
                              ? "#2563eb"
                              : "#16a34a",
                      }}
                    >
                      {message}
                    </div>
                  </div>
                  <button
                    onClick={() => setMessage("")}
                    style={{
                      width: "28px",
                      height: "28px",
                      borderRadius: "8px",
                      border: "none",
                      backgroundColor: "transparent",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: message.includes("❌")
                        ? "#dc2626"
                        : message.includes("⚠️")
                          ? "#d97706"
                          : message.includes("🔄") || message.includes("🔍")
                            ? "#2563eb"
                            : "#16a34a",
                      fontSize: "18px",
                      transition: "background-color 0.2s",
                    }}
                    onMouseOver={(e) =>
                      (e.currentTarget.style.backgroundColor =
                        "rgba(0,0,0,0.05)")
                    }
                    onMouseOut={(e) =>
                      (e.currentTarget.style.backgroundColor = "transparent")
                    }
                  >
                    ×
                  </button>
                </div>
              </div>
            )}

            <div style={styles.videoSection}>
              <div
                style={{
                  ...styles.videoGrid,
                  gridTemplateColumns: isDetecting ? "1fr 1fr" : "1fr",
                }}
              >
                {/* Live Feed / Frozen Frame */}
                <div>
                  <div style={styles.videoLabel}>
                    {isDetecting
                      ? "📹 Live Feed"
                      : isFrozen
                        ? "🔒 Frozen Frame"
                        : "📹 Live Feed"}
                  </div>
                  <div style={styles.videoContainer}>
                    {cameraActive && (
                      <img
                        ref={setImageRef}
                        src={ipUrl}
                        alt="IP Webcam"
                        crossOrigin="anonymous"
                        style={{
                          maxWidth: "100%",
                          maxHeight: "100%",
                          width: "auto",
                          height: "auto",
                          objectFit: "contain",
                          display: isFrozen ? "none" : "block",
                        }}
                        onLoad={(e) => {
                          const img = e.target;
                          const checkAndSetup = () => {
                            const w = img.naturalWidth || 0;
                            const h = img.naturalHeight || 0;

                            if (w > 0 && h > 0 && !(w === 300 && h === 150)) {
                              console.log("📹 Stream loaded:", { w, h });
                              setupDrawingCanvas(img);
                              if (!isDetecting && !isFrozen) {
                                setMessage("📹 Stream ready");
                              }
                            } else {
                              setTimeout(checkAndSetup, 100);
                            }
                          };
                          checkAndSetup();
                        }}
                        onError={() =>
                          setMessage("Failed to load video stream")
                        }
                      />
                    )}

                    {cameraActive && isFrozen && (
                      <>
                        {frozenImage && (
                          <img
                            ref={frozenImageRef}
                            src={frozenImage}
                            alt="Frozen frame"
                            style={{
                              maxWidth: "100%",
                              maxHeight: "100%",
                              width: "auto",
                              height: "auto",
                              objectFit: "contain",
                              display: "block",
                              position: "relative",
                              zIndex: 1,
                            }}
                            onLoad={(e) => {
                              const img = e.target;
                              setFrozenDimensions((prev) => ({
                                ...prev,
                                displayWidth: img.offsetWidth,
                                displayHeight: img.offsetHeight,
                              }));
                            }}
                          />
                        )}
                        <canvas
                          ref={frozenCanvasRef}
                          style={{
                            width: "100%",
                            height: "auto",
                            display: "none",
                            background: "transparent",
                            position: "relative",
                            zIndex: 2,
                          }}
                        />
                        <div style={styles.frozenBadge}>🔒 FROZEN</div>
                      </>
                    )}

                    {!cameraActive && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          minHeight: "400px",
                          color: "#9ca3af",
                          fontSize: "18px",
                        }}
                      >
                        📹 Connect IP Webcam to start
                      </div>
                    )}

                    {/* Drawing Canvas */}
                    {cameraActive && !isDetecting && isFrozen && (
                      <canvas
                        ref={drawingCanvasRef}
                        onMouseDown={handleCanvasMouseDown}
                        onMouseMove={handleCanvasMouseMove}
                        onMouseUp={handleCanvasMouseUp}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width:
                            frozenDimensions.displayWidth > 0
                              ? `${frozenDimensions.displayWidth}px`
                              : "100%",
                          height:
                            frozenDimensions.displayHeight > 0
                              ? `${frozenDimensions.displayHeight}px`
                              : "auto",
                          zIndex: 10,
                          cursor:
                            isDrawingMode || aoiMode
                              ? "crosshair"
                              : isAdjustMode
                                ? "move"
                                : "default",
                          pointerEvents: "auto",
                        }}
                      />
                    )}

                    {/* Freeze Button */}
                    {cameraActive && !isDetecting && (
                      <button
                        style={styles.freezeButton}
                        onClick={isFrozen ? unfreezeFrame : freezeFrame}
                      >
                        <span style={{ fontSize: "20px" }}>
                          {isFrozen ? "▶️" : "⏸"}
                        </span>
                        <span>{isFrozen ? "Unfreeze" : "Freeze Frame"}</span>
                      </button>
                    )}

                    {/* Drawing Tooltip */}
                    {(aoiMode || isDrawingMode) && (
                      <div style={styles.tooltip}>
                        <span style={{ color: "#fbbf24", fontSize: "18px" }}>
                          ✋
                        </span>
                        {aoiMode
                          ? "Drag to define the Area of Interest"
                          : "Click and drag to draw parking slot"}
                      </div>
                    )}
                  </div>
                </div>

                {/* Processed Frame (during detection) */}
                {isDetecting && (
                  <div>
                    <div style={styles.videoLabel}>
                      🧠 AI Processed ({fps} FPS)
                    </div>
                    <div style={styles.videoContainer}>
                      <canvas
                        ref={processedCanvasRef}
                        style={{
                          width: "100%",
                          height: "auto",
                          minHeight: "400px",
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Occupancy Status */}
              {isDetecting && occupancyStatus?.slots && (
                <div style={styles.occupancyGrid}>
                  {Object.entries(occupancyStatus.slots || {}).map(
                    ([slotNum, data]) => {
                      const status = data?.status || "unknown";
                      const bgColor =
                        status === "occupied"
                          ? "#FEE2E2"
                          : status === "vacant"
                            ? "#ECFDF5"
                            : "#F3F4F6";
                      const borderColor =
                        status === "occupied"
                          ? "#FCA5A5"
                          : status === "vacant"
                            ? "#A7F3D0"
                            : "#E5E7EB";
                      const textColor =
                        status === "occupied"
                          ? "#B91C1C"
                          : status === "vacant"
                            ? "#065F46"
                            : "#374151";

                      return (
                        <div
                          key={slotNum}
                          style={{
                            ...styles.occupancyCard,
                            backgroundColor: bgColor,
                            border: `1px solid ${borderColor}`,
                          }}
                        >
                          <div
                            style={{
                              fontWeight: 600,
                              color: textColor,
                              marginBottom: "4px",
                            }}
                          >
                            Slot #{slotNum}
                          </div>
                          <div style={{ fontSize: "12px", color: "#6B7280" }}>
                            <span
                              style={{
                                fontWeight: 600,
                                color: textColor,
                                textTransform: "capitalize",
                              }}
                            >
                              {status}
                            </span>
                          </div>
                          <div style={{ fontSize: "11px", color: "#9CA3AF" }}>
                            {data?.confidence || "N/A"}
                          </div>
                        </div>
                      );
                    },
                  )}
                </div>
              )}
            </div>

            {/* Hidden Canvases */}
            <canvas ref={canvasRef} style={{ display: "none" }} />
          </div>
        </main>
      </div>
    </div>
  );
}

export default AICameraSetup;