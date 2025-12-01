// src/client/main.ts
import { CanvasState } from "../crdt/CanvasState";
import { PixelUpdate } from "../crdt/types";

const GRID = 100;
const PIXEL_SIZE = 14;
const LOCAL_KEY = "localCanvasState";
const COLOR_KEY = "ui.color";
const QUEUE_KEY = "offlinePixelQueue";

const wsUrl =
    location.protocol === "https:"
        ? `wss://${location.host}`
        : `ws://${location.host}`;
const ws = new WebSocket(wsUrl);

// Elements
const canvasElem = document.getElementById("canvas") as HTMLCanvasElement;
const overlayElem = document.getElementById("overlay") as HTMLCanvasElement;
const ctx = canvasElem.getContext("2d")!;
const octx = overlayElem.getContext("2d")!;
const colorPicker = document.getElementById("colorPicker") as HTMLInputElement;
const modeToggle = document.getElementById("modeToggle") as HTMLButtonElement | null;
const statusBadge = document.getElementById("statusBadge") as HTMLElement | null;

// State
const canvas = new CanvasState();
const localUserId = "local-" + Math.random().toString(36).slice(2);
let currentColor = localStorage.getItem(COLOR_KEY) || "#ff0000";
let batchingEnabled = true;
const cursors = new Map<string, { x:number; y:number; color:string; ts:number }>();

colorPicker.value = currentColor;
colorPicker.addEventListener("input", () => {
    currentColor = colorPicker.value;
    localStorage.setItem(COLOR_KEY, currentColor);
});

function updateModeUI() {
    if (!modeToggle) return;
    modeToggle.textContent = batchingEnabled ? "MODE: BATCHED" : "MODE: PER-PIXEL";
    modeToggle.classList.toggle("mode-toggle-batched", batchingEnabled);
    modeToggle.classList.toggle("mode-toggle-perpixel", !batchingEnabled);
}

function updateStatusUI() {
    if (!statusBadge) return;
    const online = ws.readyState === WebSocket.OPEN;
    statusBadge.classList.toggle("status-online", online);
    statusBadge.classList.toggle("status-offline", !online);
    if (online) {
        const queued = offlineQueue.length;
        statusBadge.textContent = queued > 0 ? `SYNCING ${queued}` : "ONLINE";
    } else {
        statusBadge.textContent = `OFFLINE (${offlineQueue.length})`;
    }
}

modeToggle?.addEventListener("click", () => {
    batchingEnabled = !batchingEnabled;
    updateModeUI();
});

updateModeUI();

// ---- Batching pixel updates over WebSocket ----
const BATCH_INTERVAL_MS = 40; // ~25fps
let pendingUpdates: PixelUpdate[] = [];
let flushTimer: number | null = null;

// ---- Offline queue for PixelUpdate operations ----
let offlineQueue: PixelUpdate[] = [];

function loadOfflineQueue() {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return;
    try {
        offlineQueue = JSON.parse(raw) as PixelUpdate[];
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
    updateStatusUI();
}

function flushUpdates() {
    if (!pendingUpdates.length) return;
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "PixelBatch", updates: pendingUpdates }));
    }
    pendingUpdates = [];
    flushTimer = null;
}

function enqueueUpdate(update: PixelUpdate) {
    pendingUpdates.push(update);
    if (flushTimer === null) {
        flushTimer = window.setTimeout(flushUpdates, BATCH_INTERVAL_MS);
    }
}

function sendUpdate(update: PixelUpdate) {
    if (ws.readyState === WebSocket.OPEN) {
        if (batchingEnabled) {
            enqueueUpdate(update);
        } else {
            ws.send(JSON.stringify({ type: "PixelUpdate", ...update }));
        }
    } else {
        // Offline: queue the update locally for later sync
        offlineQueue.push(update);
        saveOfflineQueue();
    }
}

function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const cssW = GRID * PIXEL_SIZE;
    const cssH = GRID * PIXEL_SIZE;

    for (const el of [canvasElem, overlayElem]) {
        el.style.width = cssW + "px";
        el.style.height = cssH + "px";
        el.width  = Math.floor(cssW * dpr);
        el.height = Math.floor(cssH * dpr);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);

    redrawAll();
}

// Draw the pixels
function drawPixel(p: PixelUpdate) {
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x * PIXEL_SIZE, p.y * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
}
function redrawAll() {
    ctx.clearRect(0, 0, GRID * PIXEL_SIZE, GRID * PIXEL_SIZE);
    for (const p of canvas.getAll()) drawPixel(p);
}

// Local persistence
function saveLocalState() {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(canvas.getAll()));
}
function loadLocalState() {
    const s = localStorage.getItem(LOCAL_KEY);
    if (!s) return;
    try { (JSON.parse(s) as PixelUpdate[]).forEach(p => canvas.apply(p)); } catch {}
}
function applyAndPersist(update: PixelUpdate) {
    // Only update in-memory + on-screen; no localStorage persistence
    if (canvas.apply(update)) { drawPixel(update); }
}

// Grid coordinates
function eventToGrid(e: MouseEvent | PointerEvent) {
    const rect = canvasElem.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const gx = Math.floor(x / PIXEL_SIZE), gy = Math.floor(y / PIXEL_SIZE);
    if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) return null;
    return { gx, gy };
}

// Painting (click/drag)
let isDown = false;
canvasElem.addEventListener("pointerdown", (e) => {
    const g = eventToGrid(e); if (!g) return;
    isDown = true; paintAt(g.gx, g.gy);
});
canvasElem.addEventListener("pointermove", (e) => {
    sendCursor(e);
    if (!isDown) return;
    const g = eventToGrid(e); if (!g) return;
    paintAt(g.gx, g.gy);
});
window.addEventListener("pointerup", () => {
    isDown = false;
    flushUpdates();
});

function paintAt(gx: number, gy: number) {
    const update: PixelUpdate = {
        canvasId: "default", x: gx, y: gy, color: currentColor,
        ts: Date.now(), userId: localUserId, opId: crypto.randomUUID(),
    };
    applyAndPersist(update);
    sendUpdate(update);
}

//Live cursor
let lastSent = 0;
function sendCursor(e: PointerEvent) {
    const g = eventToGrid(e); if (!g) return;
    const now = performance.now();
    if (now - lastSent < 33) return; // ~30fps
    lastSent = now;
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "CURSOR", userId: localUserId, x: g.gx, y: g.gy, color: currentColor, ts: Date.now() }));
    }
}
function drawCursorLayer() {
    octx.clearRect(0, 0, GRID * PIXEL_SIZE, GRID * PIXEL_SIZE);
    const now = Date.now();
    for (const [id, c] of cursors) {
        if (now - c.ts > 60000) { cursors.delete(id); continue; }
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
loadOfflineQueue();
// loadLocalState(); // disabled: avoid per-browser divergent state
resizeCanvas();
requestAnimationFrame(drawCursorLayer);
window.addEventListener("resize", resizeCanvas);

ws.onopen = () => {
    ws.send(JSON.stringify({ type: "AUTH", idToken: "fake-yale-token" }));
    flushOfflineQueue();
};

ws.onclose = () => {
    updateStatusUI();
};

ws.onerror = () => {
    updateStatusUI();
};
ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "SNAPSHOT") {
        (msg.pixels as PixelUpdate[]).forEach(p => applyAndPersist(p));
    } else if (msg.type === "PixelUpdate") {
        applyAndPersist(msg as PixelUpdate);
    } else if (msg.type === "CURSOR" && msg.userId !== localUserId) {
        cursors.set(msg.userId, { x: msg.x, y: msg.y, color: msg.color, ts: Date.now() });
    }
};
