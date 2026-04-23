"use strict";
(() => {
  var CanvasState = class {
    pixels = /* @__PURE__ */ new Map();
    makeKey(update) {
      return `${update.canvasId}:${update.x}:${update.y}`;
    }
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

  var GRID = 100;
  var PIXEL_SIZE = 14;
  /** 4×4 equal squares (25×25 grid cells each). 16 cells cover the canvas; 14 match residential colleges + 2 neutral corners in row-major labeling if we add labels later. */
  var BORDER_MACRO = 4;
  var BORDER_CELL = GRID / BORDER_MACRO;
  var COLOR_KEY = "ui.color";
  var wsUrl = location.protocol === "https:" ? `wss://${location.host}` : `ws://${location.host}`;
  var ws = new WebSocket(wsUrl);
  var canvasElem = document.getElementById("canvas");
  var overlayElem = document.getElementById("overlay");
  var minimapElem = document.getElementById("minimap");
  var ctx = canvasElem.getContext("2d");
  var octx = overlayElem.getContext("2d");
  var minimapCtx = minimapElem ? minimapElem.getContext("2d") : null;
  var colorPicker = document.getElementById("colorPicker");
  var modeToggle = document.getElementById("modeToggle");
  var bordersToggle = document.getElementById("bordersToggle");
  var undoBtn = document.getElementById("undoBtn");
  var redoBtn = document.getElementById("redoBtn");
  var profileEl = document.getElementById("profile");
  var leaderboardEl = document.getElementById("leaderboard");
  /** Residential college codes (same order as server) for border-zone labels. */
  var collegeCodes = [];

  function randomId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    var bytes = new Uint8Array(16);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (var i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    var hex = Array.from(bytes).map(function(b) { return b.toString(16).padStart(2, "0"); }).join("");
    return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
  }

  var canvas = new CanvasState();
  var selfNetId = "local-" + Math.random().toString(36).slice(2);
  var selfCollege = "";
  var selfDisplayName = "";
  var currentColor = localStorage.getItem(COLOR_KEY) || "#ff0000";
  var batchingEnabled = true;
  var cursors = /* @__PURE__ */ new Map();
  var showBorders = false;
  var heat = new Uint16Array(GRID * GRID);
  var minimapDirty = true;
  var minimapTimer = null;
  var undoStack = [];
  var redoStack = [];
  var MAX_UNDO = 80;

  function bumpHeat(gx, gy) {
    const i = gy * GRID + gx;
    if (i >= 0 && i < heat.length) heat[i] = Math.min(65535, heat[i] + 1);
    minimapDirty = true;
  }
  function scheduleMinimap() {
    if (!minimapCtx) return;
    if (minimapTimer) return;
    minimapTimer = window.setTimeout(function() {
      minimapTimer = null;
      if (!minimapDirty) return;
      minimapDirty = false;
      drawMinimap();
    }, 120);
  }
  var MS = 10;
  var BLOCK = GRID / MS;
  function drawMinimap() {
    if (!minimapCtx || !minimapElem) return;
    var mw = minimapElem.width;
    var mh = minimapElem.height;
    var cw = mw / MS;
    var ch = mh / MS;
    minimapCtx.clearRect(0, 0, mw, mh);
    for (var my = 0; my < MS; my++) {
      for (var mx = 0; mx < MS; mx++) {
        var sum = 0;
        for (var dy = 0; dy < BLOCK; dy++) {
          for (var dx = 0; dx < BLOCK; dx++) {
            sum += heat[(my * BLOCK + dy) * GRID + (mx * BLOCK + dx)] | 0;
          }
        }
        var v = Math.min(255, Math.floor(sum / 4));
        minimapCtx.fillStyle = "rgb(" + v + "," + Math.floor(v * 0.6) + "," + (255 - v) + ")";
        minimapCtx.fillRect(Math.floor(mx * cw), Math.floor(my * ch), Math.ceil(cw), Math.ceil(ch));
      }
    }
  }

  var BATCH_INTERVAL_MS = 40;
  var pendingUpdates = [];
  var flushTimer = null;
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
    if (batchingEnabled) {
      enqueueUpdate(update);
    } else if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "PixelUpdate", ...update }));
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
  bordersToggle == null ? void 0 : bordersToggle.addEventListener("click", () => {
    showBorders = !showBorders;
    bordersToggle.textContent = showBorders ? "College borders: ON" : "College borders: OFF";
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
    heat.fill(0);
    for (const p of canvas.getAll()) {
      drawPixel(p);
      bumpHeat(p.x, p.y);
    }
    scheduleMinimap();
  }
  function applyAndPersist(update) {
    if (canvas.apply(update)) {
      drawPixel(update);
      bumpHeat(update.x, update.y);
      scheduleMinimap();
    }
  }
  function eventToGrid(e) {
    const rect = canvasElem.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const gx = Math.floor(x / PIXEL_SIZE), gy = Math.floor(y / PIXEL_SIZE);
    if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) return null;
    return { gx, gy };
  }
  function snapshotCell(gx, gy) {
    const prev = canvas.getPixel("default", gx, gy);
    return prev ? { ...prev } : null;
  }
  var isDown = false;
  canvasElem.addEventListener("pointerdown", (e) => {
    const g = eventToGrid(e);
    if (!g) return;
    isDown = true;
    paintAt(g.gx, g.gy, {});
  });
  canvasElem.addEventListener("pointermove", (e) => {
    sendCursor(e);
    if (!isDown) return;
    const g = eventToGrid(e);
    if (!g) return;
    paintAt(g.gx, g.gy, {});
  });
  window.addEventListener("pointerup", () => {
    isDown = false;
    flushUpdates();
  });

  function paintAt(gx, gy, opts) {
    opts = opts || {};
    const update = {
      canvasId: "default",
      x: gx,
      y: gy,
      color: opts.color != null ? opts.color : currentColor,
      ts: Date.now(),
      userId: selfNetId,
      opId: randomId()
    };
    if (!opts.skipHistory) {
      redoStack.length = 0;
      undoStack.push({ before: snapshotCell(gx, gy), forward: { ...update } });
      if (undoStack.length > MAX_UNDO) undoStack.shift();
    }
    applyAndPersist(update);
    if (!opts.noSend) sendUpdate(update);
  }

  function undo() {
    const e = undoStack.pop();
    if (!e || !e.forward) return;
    redoStack.push({ forward: e.forward });
    var revert;
    if (!e.before) {
      revert = {
        canvasId: "default",
        x: e.forward.x,
        y: e.forward.y,
        color: "#ffffff",
        ts: Date.now(),
        userId: selfNetId,
        opId: randomId()
      };
    } else {
      revert = { ...e.before, ts: Date.now(), opId: randomId(), userId: selfNetId };
    }
    applyAndPersist(revert);
    sendUpdate(revert);
  }
  function redo() {
    const e = redoStack.pop();
    if (!e || !e.forward) return;
    const f = { ...e.forward, ts: Date.now(), opId: randomId(), userId: selfNetId };
    undoStack.push({ before: snapshotCell(f.x, f.y), forward: { ...f } });
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    applyAndPersist(f);
    sendUpdate(f);
  }
  undoBtn == null ? void 0 : undoBtn.addEventListener("click", () => undo());
  redoBtn == null ? void 0 : redoBtn.addEventListener("click", () => redo());
  window.addEventListener("keydown", (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") {
      ev.preventDefault();
      if (ev.shiftKey) redo();
      else undo();
    }
  });

  var lastSent = 0;
  function sendCursor(e) {
    const g = eventToGrid(e);
    if (!g) return;
    const now = performance.now();
    if (now - lastSent < 33) return;
    lastSent = now;
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "CURSOR",
          userId: selfNetId,
          x: g.gx,
          y: g.gy,
          color: currentColor,
          ts: Date.now()
        })
      );
    }
  }

  function drawCollegeBorders() {
    if (!showBorders) return;
    octx.save();
    octx.strokeStyle = "rgba(80,40,120,0.55)";
    octx.lineWidth = 1.5;
    for (var k = 1; k < BORDER_MACRO; k++) {
      var xPx = k * BORDER_CELL * PIXEL_SIZE;
      octx.beginPath();
      octx.moveTo(xPx + 0.5, 0);
      octx.lineTo(xPx + 0.5, GRID * PIXEL_SIZE);
      octx.stroke();
      var yPx = k * BORDER_CELL * PIXEL_SIZE;
      octx.beginPath();
      octx.moveTo(0, yPx + 0.5);
      octx.lineTo(GRID * PIXEL_SIZE, yPx + 0.5);
      octx.stroke();
    }
    if (collegeCodes.length) {
      octx.font = "bold 11px system-ui, sans-serif";
      octx.textAlign = "center";
      octx.textBaseline = "middle";
      for (var by = 0; by < BORDER_MACRO; by++) {
        for (var bx = 0; bx < BORDER_MACRO; bx++) {
          var idx = by * BORDER_MACRO + bx;
          var lab = idx < collegeCodes.length ? collegeCodes[idx] || "—" : "·";
          var cx = (bx + 0.5) * BORDER_CELL * PIXEL_SIZE;
          var cy = (by + 0.5) * BORDER_CELL * PIXEL_SIZE;
          octx.fillStyle = "rgba(255,255,255,0.5)";
          octx.fillRect(cx - 16, cy - 9, 32, 18);
          octx.fillStyle = "rgba(40,20,70,0.92)";
          octx.fillText(lab, cx, cy);
        }
      }
    }
    octx.restore();
  }

  function renderTerritoryLeaderboard(data) {
    if (!leaderboardEl || !data) return;
    leaderboardEl.replaceChildren();
    var rows = (data.ranked || []).slice(0, 16);
    if (!rows.length) {
      var empty = document.createElement("p");
      empty.className = "lb-empty";
      empty.textContent = "No painted pixels yet — territory updates live as people draw.";
      leaderboardEl.appendChild(empty);
      return;
    }
    var ol = document.createElement("ol");
    ol.className = "lb-list";
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var li = document.createElement("li");
      var place = document.createElement("span");
      place.className = "lb-place";
      place.textContent = String(i + 1);
      var name = document.createElement("span");
      name.className = "lb-college";
      name.textContent = r.college;
      var count = document.createElement("span");
      count.className = "lb-count";
      count.textContent = r.pixels.toLocaleString() + " px";
      li.appendChild(place);
      li.appendChild(name);
      li.appendChild(count);
      ol.appendChild(li);
    }
    leaderboardEl.appendChild(ol);
    var foot = document.createElement("div");
    foot.className = "lb-total";
    foot.textContent =
      "Total painted cells: " + (data.totalPixels != null ? data.totalPixels : 0).toLocaleString();
    leaderboardEl.appendChild(foot);
  }

  async function refreshLeaderboard() {
    if (!leaderboardEl) return;
    try {
      const r = await fetch("/api/leaderboard", { credentials: "same-origin" });
      if (!r.ok) return;
      const j = await r.json();
      renderTerritoryLeaderboard(j);
    } catch {
    }
  }

  function drawCursorLayer() {
    octx.clearRect(0, 0, GRID * PIXEL_SIZE, GRID * PIXEL_SIZE);
    drawCollegeBorders();
    const now = Date.now();
    octx.font = "10px system-ui, sans-serif";
    octx.textBaseline = "top";
    for (const [id, c] of cursors) {
      if (now - c.ts > 6e4) {
        cursors.delete(id);
        continue;
      }
      octx.save();
      octx.globalAlpha = 0.9;
      octx.strokeStyle = c.color;
      octx.lineWidth = 2;
      octx.strokeRect(c.x * PIXEL_SIZE + 0.5, c.y * PIXEL_SIZE + 0.5, PIXEL_SIZE - 1, PIXEL_SIZE - 1);
      var label =
        (c.displayName || c.netId || c.userId || "?") + (c.college ? " · " + c.college : "");
      var lx = c.x * PIXEL_SIZE;
      var ly = c.y * PIXEL_SIZE + PIXEL_SIZE + 2;
      octx.fillStyle = "rgba(20,10,40,0.88)";
      var tw = octx.measureText(label).width;
      octx.fillRect(lx, ly, tw + 6, 14);
      octx.fillStyle = "#f5f0ff";
      octx.fillText(label, lx + 3, ly + 2);
      octx.restore();
    }
    requestAnimationFrame(drawCursorLayer);
  }

  resizeCanvas();
  requestAnimationFrame(drawCursorLayer);
  window.addEventListener("resize", resizeCanvas);
  setInterval(refreshLeaderboard, 8e3);
  refreshLeaderboard();
  fetch("/api/colleges", { credentials: "same-origin" })
    .then(function(r) {
      return r.ok ? r.json() : { codes: [] };
    })
    .then(function(j) {
      collegeCodes = j.codes || [];
    })
    .catch(function() {
      collegeCodes = [];
    });

  ws.onopen = async () => {
    try {
      const r = await fetch("/api/ws-token", { credentials: "same-origin" });
      if (r.ok) {
        const j = await r.json();
        ws.send(JSON.stringify({ type: "AUTH", token: j.token }));
        return;
      }
    } catch {
    }
    ws.send(JSON.stringify({ type: "AUTH", idToken: "fake-yale-token" }));
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "AUTH_ACK") {
      if (msg.userId) selfNetId = msg.userId;
      if (msg.college) selfCollege = msg.college;
      if (msg.displayName) selfDisplayName = msg.displayName;
      if (profileEl) {
        profileEl.textContent =
          (selfDisplayName ? selfDisplayName + " — " : "") +
          (msg.netId || msg.userId || "") +
          (selfCollege ? " · " + selfCollege : "");
      }
    } else if (msg.type === "SNAPSHOT") {
      heat.fill(0);
      canvas.clear();
      ctx.clearRect(0, 0, GRID * PIXEL_SIZE, GRID * PIXEL_SIZE);
      msg.pixels.forEach((p) => applyAndPersist(p));
      refreshLeaderboard();
    } else if (msg.type === "PixelUpdate") {
      applyAndPersist(msg);
    } else if (msg.type === "LEADERBOARD") {
      renderTerritoryLeaderboard(msg);
    } else if (msg.type === "CURSOR" && msg.userId !== selfNetId) {
      cursors.set(msg.userId, {
        x: msg.x,
        y: msg.y,
        color: msg.color,
        netId: msg.netId,
        college: msg.college,
        displayName: msg.displayName,
        ts: Date.now()
      });
    }
  };
})();
