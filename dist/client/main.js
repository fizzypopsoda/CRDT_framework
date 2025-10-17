"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/client/main.ts
const CanvasState_1 = require("../crdt/CanvasState");
const GRID = 100;
const PIXEL_SIZE = 14;
const LOCAL_KEY = "localCanvasState";
const COLOR_KEY = "ui.color";
const wsUrl = location.protocol === "https:"
    ? `wss://${location.host}`
    : `ws://${location.host}`;
const ws = new WebSocket(wsUrl);
// Elements
const canvasElem = document.getElementById("canvas");
const overlayElem = document.getElementById("overlay");
const ctx = canvasElem.getContext("2d");
const octx = overlayElem.getContext("2d");
const colorPicker = document.getElementById("colorPicker");
// State
const canvas = new CanvasState_1.CanvasState();
const localUserId = "local-" + Math.random().toString(36).slice(2);
let currentColor = localStorage.getItem(COLOR_KEY) || "#ff0000";
const cursors = new Map();
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
// Draw the pixels
function drawPixel(p) {
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x * PIXEL_SIZE, p.y * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
}
function redrawAll() {
    ctx.clearRect(0, 0, GRID * PIXEL_SIZE, GRID * PIXEL_SIZE);
    for (const p of canvas.getAll())
        drawPixel(p);
}
// Local persistence
function saveLocalState() {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(canvas.getAll()));
}
function loadLocalState() {
    const s = localStorage.getItem(LOCAL_KEY);
    if (!s)
        return;
    try {
        JSON.parse(s).forEach(p => canvas.apply(p));
    }
    catch { }
}
function applyAndPersist(update) {
    if (canvas.apply(update)) {
        drawPixel(update);
        saveLocalState();
    }
}
// Grid coordinates
function eventToGrid(e) {
    const rect = canvasElem.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const gx = Math.floor(x / PIXEL_SIZE), gy = Math.floor(y / PIXEL_SIZE);
    if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID)
        return null;
    return { gx, gy };
}
// Painting (click/drag)
let isDown = false;
canvasElem.addEventListener("pointerdown", (e) => {
    const g = eventToGrid(e);
    if (!g)
        return;
    isDown = true;
    paintAt(g.gx, g.gy);
});
canvasElem.addEventListener("pointermove", (e) => {
    sendCursor(e);
    if (!isDown)
        return;
    const g = eventToGrid(e);
    if (!g)
        return;
    paintAt(g.gx, g.gy);
});
window.addEventListener("pointerup", () => (isDown = false));
function paintAt(gx, gy) {
    const update = {
        canvasId: "default", x: gx, y: gy, color: currentColor,
        ts: Date.now(), userId: localUserId, opId: crypto.randomUUID(),
    };
    applyAndPersist(update);
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "PixelUpdate", ...update }));
    }
}
//Live cursor
let lastSent = 0;
function sendCursor(e) {
    const g = eventToGrid(e);
    if (!g)
        return;
    const now = performance.now();
    if (now - lastSent < 33)
        return; // ~30fps
    lastSent = now;
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "CURSOR", userId: localUserId, x: g.gx, y: g.gy, color: currentColor, ts: Date.now() }));
    }
}
function drawCursorLayer() {
    octx.clearRect(0, 0, GRID * PIXEL_SIZE, GRID * PIXEL_SIZE);
    const now = Date.now();
    for (const [id, c] of cursors) {
        if (now - c.ts > 60000) {
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
//Init
loadLocalState();
resizeCanvas();
requestAnimationFrame(drawCursorLayer);
window.addEventListener("resize", resizeCanvas);
ws.onopen = () => {
    ws.send(JSON.stringify({ type: "AUTH", idToken: "fake-yale-token" }));
};
ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "SNAPSHOT") {
        msg.pixels.forEach(p => applyAndPersist(p));
    }
    else if (msg.type === "PixelUpdate") {
        applyAndPersist(msg);
    }
    else if (msg.type === "CURSOR" && msg.userId !== localUserId) {
        cursors.set(msg.userId, { x: msg.x, y: msg.y, color: msg.color, ts: Date.now() });
    }
};
