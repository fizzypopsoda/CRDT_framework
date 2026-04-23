"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const ws_1 = require("ws");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const CanvasState_1 = require("../crdt/CanvasState");
const path_1 = __importDefault(require("path"));
const redis_1 = require("./redis");
const analyticsClient_1 = require("./analyticsClient");
const genaiEval_1 = require("./genaiEval");
const college_1 = require("./college");
const app = (0, express_1.default)();
const useRedis = process.env.USE_REDIS !== "false" && !!process.env.REDIS_URL;
let lastWsMessageAt = null;
(async () => {
    const { setupAuth } = await Promise.resolve().then(() => __importStar(require("./auth")));
    setupAuth(app);
    app.use(express_1.default.json({ limit: "512kb" }));
    (0, genaiEval_1.registerGenaiEvalRoutes)(app);
    await (0, redis_1.initRedis)();
    const server = (0, http_1.createServer)(app);
    const wss = new ws_1.WebSocketServer({ server });
    const canvas = new CanvasState_1.CanvasState();
    function getLeaderboardSnapshot() {
        const counts = new Map();
        for (const p of canvas.getAll()) {
            const c = p.college || "—";
            counts.set(c, (counts.get(c) || 0) + 1);
        }
        const ranked = [...counts.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([college, pixels]) => ({ college, pixels }));
        return { ranked, totalPixels: canvas.getAll().length };
    }
    let leaderboardBroadcastTimer = null;
    function scheduleLeaderboardBroadcast() {
        if (leaderboardBroadcastTimer)
            return;
        leaderboardBroadcastTimer = setTimeout(() => {
            leaderboardBroadcastTimer = null;
            const snap = getLeaderboardSnapshot();
            const payload = JSON.stringify({ type: "LEADERBOARD", ...snap });
            for (const client of wss.clients) {
                if (client.readyState === ws_1.WebSocket.OPEN) {
                    client.send(payload);
                }
            }
        }, 280);
    }
    async function loadCanvas() {
        if (!useRedis || !redis_1.redis)
            return;
        const data = await redis_1.redis.hGetAll("canvas:default:pixels");
        for (const field in data) {
            const pixel = JSON.parse(data[field]);
            canvas.apply(pixel);
        }
        console.log(`Loaded ${Object.keys(data).length} pixels from Redis`);
    }
    await loadCanvas();
    async function savePixel(update) {
        if (!useRedis || !redis_1.redis)
            return;
        const field = `${update.x}:${update.y}`;
        await redis_1.redis.hSet("canvas:default:pixels", field, JSON.stringify(update));
    }
    async function clearCanvas() {
        if (!useRedis || !redis_1.redis)
            return;
        const keys = await redis_1.redis.hKeys("canvas:default:pixels");
        if (keys.length)
            await redis_1.redis.hDel("canvas:default:pixels", keys);
    }
    const publicPath = path_1.default.resolve(__dirname, "../public");
    app.use(express_1.default.static(publicPath));
    app.get("/", (_req, res) => {
        res.sendFile(path_1.default.join(publicPath, "test-client.html"));
    });
    app.get("/api/health", (_req, res) => {
        res.json({ status: "ok", ts: Date.now() });
    });
    app.get("/api/stats", (_req, res) => {
        const pixels = canvas.getAll();
        const count = pixels.length;
        const keys = new Set(pixels.map((p) => `${p.canvasId}:${p.x}:${p.y}`));
        res.json({
            pixelCount: count,
            uniqueKeys: keys.size,
            consistent: keys.size === count,
        });
    });
    app.get("/api/ping", (_req, res) => {
        res.json({ ok: true, ts: Date.now(), lastWsMessageAt });
    });
    app.get("/api/colleges", (_req, res) => {
        res.json({ codes: [...college_1.RESIDENTIAL_COLLEGE_CODES] });
    });
    app.get("/api/leaderboard", (_req, res) => {
        res.json(getLeaderboardSnapshot());
    });
    wss.on("connection", (ws) => {
        console.log("Client connected");
        ws.on("message", async (msg) => {
            try {
                const data = JSON.parse(msg.toString());
                lastWsMessageAt = Date.now();
                switch (data.type) {
                    case "AUTH": {
                        const secret = process.env.SESSION_SECRET || "temporary-secret";
                        let netId;
                        let college;
                        if (typeof data.token === "string" && data.token.length > 0) {
                            try {
                                const pl = jsonwebtoken_1.default.verify(data.token, secret);
                                netId = pl.netId || pl.sub || `anon-${Math.random().toString(36).slice(2, 8)}`;
                                college = pl.college || "Guest";
                                ws.displayName = pl.displayName;
                            }
                            catch {
                                ws.send(JSON.stringify({ type: "AUTH_ERR", error: "invalid_ws_token" }));
                                return;
                            }
                        }
                        else {
                            const payload = jsonwebtoken_1.default.decode(data.idToken);
                            netId =
                                data.analyticsId ||
                                    payload?.sub ||
                                    `anon-${Math.random().toString(36).slice(2, 8)}`;
                            college = "Guest";
                            ws.displayName = undefined;
                        }
                        ws.userId = netId;
                        ws.netId = netId;
                        ws.college = college;
                        const variant = await (0, analyticsClient_1.getAssignedVariant)(ws.userId, "pixel_size_test");
                        if (variant) {
                            (0, analyticsClient_1.logExposure)(ws.userId, "pixel_size_test", variant);
                        }
                        ws.send(JSON.stringify({
                            type: "AUTH_ACK",
                            userId: ws.userId,
                            netId: ws.netId,
                            college: ws.college,
                            displayName: ws.displayName,
                            variant: variant,
                        }));
                        ws.send(JSON.stringify({ type: "SNAPSHOT", pixels: canvas.getAll() }));
                        ws.send(JSON.stringify({ type: "LEADERBOARD", ...getLeaderboardSnapshot() }));
                        break;
                    }
                    case "PixelUpdate": {
                        if (!ws.userId)
                            return;
                        const update = {
                            canvasId: data.canvasId,
                            x: data.x,
                            y: data.y,
                            color: data.color,
                            ts: data.ts,
                            opId: data.opId,
                            userId: ws.userId,
                            college: ws.college,
                        };
                        const applied = canvas.apply(update);
                        ws.send(JSON.stringify({ type: "Ack", opId: data.opId }));
                        if (applied) {
                            const variant = await (0, analyticsClient_1.getAssignedVariant)(ws.userId, "pixel_size_test");
                            if (variant) {
                                (0, analyticsClient_1.logEvent)(ws.userId, "pixel_placed", variant);
                            }
                            await savePixel(update);
                            for (const client of wss.clients) {
                                if (client !== ws && client.readyState === ws_1.WebSocket.OPEN) {
                                    client.send(JSON.stringify({ type: "PixelUpdate", ...update }));
                                }
                            }
                            scheduleLeaderboardBroadcast();
                        }
                        break;
                    }
                    case "BatchUpdate": {
                        if (!ws.userId)
                            return;
                        const variant = await (0, analyticsClient_1.getAssignedVariant)(ws.userId, "pixel_size_test");
                        for (const update of data.updates) {
                            const fullUpdate = {
                                canvasId: update.canvasId,
                                x: update.x,
                                y: update.y,
                                color: update.color,
                                ts: update.ts,
                                opId: update.opId,
                                userId: ws.userId,
                                college: ws.college,
                            };
                            const applied = canvas.apply(fullUpdate);
                            if (applied) {
                                await savePixel(fullUpdate);
                                if (variant)
                                    (0, analyticsClient_1.logEvent)(ws.userId, "pixel_placed_batch", variant);
                            }
                        }
                        for (const client of wss.clients) {
                            if (client.readyState === ws_1.WebSocket.OPEN) {
                                client.send(JSON.stringify({ type: "BatchUpdate", updates: data.updates }));
                            }
                        }
                        scheduleLeaderboardBroadcast();
                        break;
                    }
                    case "PixelBatch": {
                        if (!ws.userId || !Array.isArray(data.updates))
                            return;
                        for (const raw of data.updates) {
                            const update = {
                                canvasId: raw.canvasId,
                                x: raw.x,
                                y: raw.y,
                                color: raw.color,
                                ts: raw.ts,
                                opId: raw.opId,
                                userId: ws.userId,
                                college: ws.college,
                            };
                            const applied = canvas.apply(update);
                            // Optional: Ack per operation
                            if (raw.opId) {
                                ws.send(JSON.stringify({ type: "Ack", opId: raw.opId }));
                            }
                            if (applied) {
                                await savePixel(update);
                                for (const client of wss.clients) {
                                    if (client !== ws && client.readyState === ws_1.WebSocket.OPEN) {
                                        client.send(JSON.stringify({ type: "PixelUpdate", ...update }));
                                    }
                                }
                            }
                        }
                        scheduleLeaderboardBroadcast();
                        break;
                    }
                    case "CURSOR": {
                        if (!ws.userId)
                            return;
                        const cursorMsg = {
                            type: "CURSOR",
                            userId: ws.userId,
                            netId: ws.netId,
                            college: ws.college,
                            displayName: ws.displayName,
                            x: data.x,
                            y: data.y,
                            color: data.color,
                            ts: Date.now(),
                        };
                        for (const client of wss.clients) {
                            if (client !== ws && client.readyState === ws_1.WebSocket.OPEN) {
                                client.send(JSON.stringify(cursorMsg));
                            }
                        }
                        break;
                    }
                    case "CLEAR": {
                        canvas.clear();
                        await clearCanvas();
                        for (const client of wss.clients) {
                            if (client.readyState === ws_1.WebSocket.OPEN) {
                                client.send(JSON.stringify({ type: "CLEAR" }));
                            }
                        }
                        scheduleLeaderboardBroadcast();
                        break;
                    }
                    default:
                        console.warn("Unknown message type", data.type);
                }
            }
            catch (err) {
                console.error("Bad message:", err);
            }
        });
    });
    const PORT = process.env.PORT || 8080;
    server.listen(PORT, () => {
        console.log(`Server and WebSocket running on port ${PORT}`);
    });
})();
