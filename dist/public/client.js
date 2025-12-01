"use strict";
(() => {
  var CanvasState = class {
    pixels = /* @__PURE__ */ new Map();
    makeKey(update) {
      return `${update.canvasId}:${update.x}:${update.y}`;
    }
    // Apply a new update, return true if it changed the state
    apply(update) {
      const key = this.makeKey(update);
      const existing = this.pixels.get(key);
      if (!existing || update.ts > existing.ts || update.ts === existing.ts && update.opId > existing.opId) {
        this.pixels.set(key, update);
        return true;
      }
      return false;
    }
    getPixel(canvasId, x, y) {
      return this.pixels.get(`${canvasId}:${x}:${y}`);
    }
    getAll() {
      return Array.from(this.pixels.values());
    }
    clear() {
      this.pixels.clear();
    }
  };

  // src/client/main.ts
  var GRID = 100;
  var PIXEL_SIZE = 14;
  var LOCAL_KEY = "localCanvasState";
  var COLOR_KEY = "ui.color";
  var QUEUE_KEY = "offlinePixelQueue";
  var wsUrl = location.protocol === "https:" ? `wss://${location.host}` : `ws://${location.host}`;
  var ws = new WebSocket(wsUrl);
  var canvasElem = document.getElementById("canvas");
  var overlayElem = document.getElementById("overlay");
  var ctx = canvasElem.getContext("2d");
  var octx = overlayElem.getContext("2d");
  var colorPicker = document.getElementById("colorPicker");
  var modeToggle = document.getElementById("modeToggle");
  var canvas = new CanvasState();
  var localUserId = "local-" + Math.random().toString(36).slice(2);
  var currentColor = localStorage.getItem(COLOR_KEY) || "#ff0000";
  var batchingEnabled = true;
  var cursors = /* @__PURE__ */ new Map();

  var BATCH_INTERVAL_MS = 40;
  var pendingUpdates = [];
  var flushTimer = null;

  var offlineQueue = [];

  function updateStatusUI() {
    if (!statusBadge) return;
    const online = navigator.onLine && ws.readyState === WebSocket.OPEN;
    statusBadge.classList.toggle("status-online", online);
    statusBadge.classList.toggle("status-offline", !online);
    if (online) {
      const queued = offlineQueue.length;
      statusBadge.textContent = queued > 0 ? `SYNCING ${queued}` : "ONLINE";
    } else {
      statusBadge.textContent = `OFFLINE (${offlineQueue.length})`;
    }
  }

  function loadOfflineQueue() {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) {
      updateStatusUI();
      return;
    }
    try {
      offlineQueue = JSON.parse(raw);
    } catch {
      offlineQueue = [];
    }
    updateStatusUI();
  }

  function saveOfflineQueue() {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(offlineQueue));
    updateStatusUI();
  }

  function flushOfflineQueue() {
    if (!offlineQueue.length || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "PixelBatch", updates: offlineQueue }));
    offlineQueue = [];
    saveOfflineQueue();
  }
  function flushUpdates() {
    if (!pendingUpdates.length) return;
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "PixelBatch", updates: pendingUpdates }));
    }
    pendingUpdates = [];
    flushTimer = null;
  }
  function enqueueUpdate(update) {
    pendingUpdates.push(update);
    if (flushTimer === null) {
      flushTimer = window.setTimeout(flushUpdates, BATCH_INTERVAL_MS);
    }
  }
  function sendUpdate(update) {
    if (ws.readyState === WebSocket.OPEN) {
      if (batchingEnabled) {
        enqueueUpdate(update);
      } else {
        ws.send(JSON.stringify({ type: "PixelUpdate", ...update }));
      }
    } else {
      offlineQueue.push(update);
      saveOfflineQueue();
    }
  }
  function updateModeUI() {
    if (!modeToggle) return;
    modeToggle.textContent = batchingEnabled ? "MODE: BATCHED" : "MODE: PER-PIXEL";
    modeToggle.classList.toggle("mode-toggle-batched", batchingEnabled);
    modeToggle.classList.toggle("mode-toggle-perpixel", !batchingEnabled);
  }
  modeToggle == null ? void 0 : modeToggle.addEventListener("click", () => {
    batchingEnabled = !batchingEnabled;
    updateModeUI();
  });
  updateModeUI();
  colorPicker.value = currentColor;
  colorPicker.addEventListener("input", () => {
    currentColor = colorPicker.value;
    localStorage.setItem(COLOR_KEY, currentColor);
  });
  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const cssW = GRID * PIXEL_SIZE;
    const cssH = GRID * PIXEL_SIZE;
    for (const el of [canvasElem, overlayElem]) {
      el.style.width = cssW + "px";
      el.style.height = cssH + "px";
      el.width = Math.floor(cssW * dpr);
      el.height = Math.floor(cssH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redrawAll();
  }
  function drawPixel(p) {
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x * PIXEL_SIZE, p.y * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
  }
  function redrawAll() {
    ctx.clearRect(0, 0, GRID * PIXEL_SIZE, GRID * PIXEL_SIZE);
    for (const p of canvas.getAll()) drawPixel(p);
  }
  function saveLocalState() {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(canvas.getAll()));
  }
  function loadLocalState() {
    const s = localStorage.getItem(LOCAL_KEY);
    if (!s) return;
    try {
      JSON.parse(s).forEach((p) => canvas.apply(p));
    } catch {
    }
  }
  function applyAndPersist(update) {
    if (canvas.apply(update)) {
      drawPixel(update);
    }
  }
  function eventToGrid(e) {
    const rect = canvasElem.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const gx = Math.floor(x / PIXEL_SIZE), gy = Math.floor(y / PIXEL_SIZE);
    if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) return null;
    return { gx, gy };
  }
  var isDown = false;
  canvasElem.addEventListener("pointerdown", (e) => {
    const g = eventToGrid(e);
    if (!g) return;
    isDown = true;
    paintAt(g.gx, g.gy);
  });
  canvasElem.addEventListener("pointermove", (e) => {
    sendCursor(e);
    if (!isDown) return;
    const g = eventToGrid(e);
    if (!g) return;
    paintAt(g.gx, g.gy);
  });
  window.addEventListener("pointerup", () => {
    isDown = false;
    flushUpdates();
  });
  function paintAt(gx, gy) {
    const update = {
      canvasId: "default",
      x: gx,
      y: gy,
      color: currentColor,
      ts: Date.now(),
      userId: localUserId,
      opId: crypto.randomUUID()
    };
    applyAndPersist(update);
    sendUpdate(update);
  }
  var lastSent = 0;
  function sendCursor(e) {
    const g = eventToGrid(e);
    if (!g) return;
    const now = performance.now();
    if (now - lastSent < 33) return;
    lastSent = now;
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "CURSOR", userId: localUserId, x: g.gx, y: g.gy, color: currentColor, ts: Date.now() }));
    }
  }
  function drawCursorLayer() {
    octx.clearRect(0, 0, GRID * PIXEL_SIZE, GRID * PIXEL_SIZE);
    const now = Date.now();
    for (const [id, c] of cursors) {
      if (now - c.ts > 6e4) {
        cursors.delete(id);
        continue;
      }
      octx.save();
      octx.globalAlpha = 0.85;
      octx.strokeStyle = c.color;
      octx.lineWidth = 2;
      octx.strokeRect(c.x * PIXEL_SIZE + 0.5, c.y * PIXEL_SIZE + 0.5, PIXEL_SIZE - 1, PIXEL_SIZE - 1);
      octx.restore();
    }
    requestAnimationFrame(drawCursorLayer);
  }
  loadOfflineQueue();
  resizeCanvas();
  requestAnimationFrame(drawCursorLayer);
  window.addEventListener("resize", resizeCanvas);
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "AUTH", idToken: "fake-yale-token" }));
    flushOfflineQueue();
    updateStatusUI();
  };
  ws.onclose = () => {
    updateStatusUI();
  };
  ws.onerror = () => {
    updateStatusUI();
  };
  window.addEventListener("online", () => {
    updateStatusUI();
  });
  window.addEventListener("offline", () => {
    updateStatusUI();
  });
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "SNAPSHOT") {
      msg.pixels.forEach((p) => applyAndPersist(p));
    } else if (msg.type === "PixelUpdate") {
      applyAndPersist(msg);
    } else if (msg.type === "CURSOR" && msg.userId !== localUserId) {
      cursors.set(msg.userId, { x: msg.x, y: msg.y, color: msg.color, ts: Date.now() });
    }
  };
})();
