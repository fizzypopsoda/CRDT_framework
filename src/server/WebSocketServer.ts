import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import jwt from "jsonwebtoken";
import { CanvasState } from "../crdt/CanvasState";
import { PixelUpdate } from "../crdt/types";
import path from "path";
import { initRedis, redis } from "./redis";
import { getAssignedVariant, logExposure, logEvent } from "./analyticsClient";
import { registerGenaiEvalRoutes } from "./genaiEval";
import { RESIDENTIAL_COLLEGE_CODES } from "./college";

const app = express();
const useRedis = process.env.USE_REDIS !== "false" && !!process.env.REDIS_URL;

let lastWsMessageAt: number | null = null;

(async () => {
    const { setupAuth } = await import("./auth");
    setupAuth(app);

    app.use(express.json({ limit: "512kb" }));
    registerGenaiEvalRoutes(app);

    await initRedis();

    const server = createServer(app);
    const wss = new WebSocketServer({ server });
    const canvas = new CanvasState();

    function getLeaderboardSnapshot(): {
        ranked: { college: string; pixels: number }[];
        totalPixels: number;
    } {
        const counts = new Map<string, number>();
        for (const p of canvas.getAll()) {
            const c = p.college || "—";
            counts.set(c, (counts.get(c) || 0) + 1);
        }
        const ranked = [...counts.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([college, pixels]) => ({ college, pixels }));
        return { ranked, totalPixels: canvas.getAll().length };
    }

    let leaderboardBroadcastTimer: ReturnType<typeof setTimeout> | null = null;
    function scheduleLeaderboardBroadcast() {
        if (leaderboardBroadcastTimer) return;
        leaderboardBroadcastTimer = setTimeout(() => {
            leaderboardBroadcastTimer = null;
            const snap = getLeaderboardSnapshot();
            const payload = JSON.stringify({ type: "LEADERBOARD", ...snap });
            for (const client of wss.clients) {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(payload);
                }
            }
        }, 280);
    }

    async function loadCanvas() {
        if (!useRedis || !redis) return;
        const data = await redis.hGetAll("canvas:default:pixels");
        for (const field in data) {
            const pixel = JSON.parse(data[field]) as PixelUpdate;
            canvas.apply(pixel);
        }
        console.log(`Loaded ${Object.keys(data).length} pixels from Redis`);
    }
    await loadCanvas();

    async function savePixel(update: PixelUpdate) {
        if (!useRedis || !redis) return;
        const field = `${update.x}:${update.y}`;
        await redis.hSet("canvas:default:pixels", field, JSON.stringify(update));
    }

    async function clearCanvas() {
        if (!useRedis || !redis) return;
        const keys = await redis.hKeys("canvas:default:pixels");
        if (keys.length) await redis.hDel("canvas:default:pixels", keys);
    }

    const publicPath = path.resolve(__dirname, "../public");
    app.use(express.static(publicPath));
    app.get("/", (_req, res) => {
        res.sendFile(path.join(publicPath, "test-client.html"));
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
        res.json({ codes: [...RESIDENTIAL_COLLEGE_CODES] });
    });

    app.get("/api/leaderboard", (_req, res) => {
        res.json(getLeaderboardSnapshot());
    });

    interface AuthedSocket extends WebSocket {
        userId?: string;
        netId?: string;
        college?: string;
        displayName?: string;
    }

    wss.on("connection", (ws: AuthedSocket) => {
        console.log("Client connected");

        ws.on("message", async (msg) => {
            try {
                const data = JSON.parse(msg.toString());
                lastWsMessageAt = Date.now();

                switch (data.type) {
                    case "AUTH": {
                        const secret = process.env.SESSION_SECRET || "temporary-secret";
                        let netId: string;
                        let college: string;
                        if (typeof data.token === "string" && data.token.length > 0) {
                            try {
                                const pl = jwt.verify(data.token, secret) as {
                                    netId?: string;
                                    college?: string;
                                    sub?: string;
                                    displayName?: string;
                                };
                                netId = pl.netId || pl.sub || `anon-${Math.random().toString(36).slice(2, 8)}`;
                                college = pl.college || "Guest";
                                ws.displayName = pl.displayName;
                            } catch {
                                ws.send(JSON.stringify({ type: "AUTH_ERR", error: "invalid_ws_token" }));
                                return;
                            }
                        } else {
                            const payload: any = jwt.decode(data.idToken);
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

                        const variant = await getAssignedVariant(ws.userId!, "pixel_size_test");
                        if (variant) {
                            logExposure(ws.userId!, "pixel_size_test", variant);
                        }

                        ws.send(
                            JSON.stringify({
                                type: "AUTH_ACK",
                                userId: ws.userId,
                                netId: ws.netId,
                                college: ws.college,
                                displayName: ws.displayName,
                                variant: variant,
                            })
                        );

                        ws.send(JSON.stringify({ type: "SNAPSHOT", pixels: canvas.getAll() }));
                        ws.send(JSON.stringify({ type: "LEADERBOARD", ...getLeaderboardSnapshot() }));
                        break;
                    }

                    case "PixelUpdate": {
                        if (!ws.userId) return;
                        const update: PixelUpdate = {
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
                            const variant = await getAssignedVariant(ws.userId, "pixel_size_test");
                            if (variant) {
                                logEvent(ws.userId, "pixel_placed", variant);
                            }

                            await savePixel(update);

                            for (const client of wss.clients) {
                                if (client !== ws && client.readyState === WebSocket.OPEN) {
                                    client.send(JSON.stringify({ type: "PixelUpdate", ...update }));
                                }
                            }
                            scheduleLeaderboardBroadcast();
                        }
                        break;
                    }
                    case "BatchUpdate": {
                        if (!ws.userId) return;

                        const variant = await getAssignedVariant(ws.userId, "pixel_size_test");

                        for (const update of data.updates) {
                            const fullUpdate: PixelUpdate = {
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
                                if (variant) logEvent(ws.userId, "pixel_placed_batch", variant);
                            }
                        }

                        for (const client of wss.clients) {
                            if (client.readyState === WebSocket.OPEN) {
                                client.send(JSON.stringify({ type: "BatchUpdate", updates: data.updates }));
                            }
                        }
                        scheduleLeaderboardBroadcast();
                        break;
                    }

                    case "PixelBatch": {
                        if (!ws.userId || !Array.isArray(data.updates)) return;

                        for (const raw of data.updates as PixelUpdate[]) {
                            const update: PixelUpdate = {
                                canvasId: raw.canvasId,
                                x: raw.x,
                                y: raw.y,
                                color: raw.color,
                                ts: raw.ts,
                                opId: raw.opId,
                                userId: ws.userId!,
                                college: ws.college,
                            };
                            const applied = canvas.apply(update);

                            // Optional: Ack per operation
                            if ((raw as any).opId) {
                                ws.send(JSON.stringify({ type: "Ack", opId: (raw as any).opId }));
                            }

                            if (applied) {
                                await savePixel(update);
                                for (const client of wss.clients) {
                                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                                        client.send(
                                            JSON.stringify({ type: "PixelUpdate", ...update })
                                        );
                                    }
                                }
                            }
                        }
                        scheduleLeaderboardBroadcast();
                        break;
                    }

                    case "CURSOR": {
                        if (!ws.userId) return;
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
                            if (client !== ws && client.readyState === WebSocket.OPEN) {
                                client.send(JSON.stringify(cursorMsg));
                            }
                        }
                        break;
                    }

                    case "CLEAR": {
                        canvas.clear();
                        await clearCanvas();
                        for (const client of wss.clients) {
                            if (client.readyState === WebSocket.OPEN) {
                                client.send(JSON.stringify({ type: "CLEAR" }));
                            }
                        }
                        scheduleLeaderboardBroadcast();
                        break;
                    }

                    default:
                        console.warn("Unknown message type", data.type);
                }
            } catch (err) {
                console.error("Bad message:", err);
            }
        });
    });

    const PORT = process.env.PORT || 8080;
    server.listen(PORT, () => {
        console.log(`Server and WebSocket running on port ${PORT}`);
    });
})();
