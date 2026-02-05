import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import jwt from "jsonwebtoken";
import { CanvasState } from "../crdt/CanvasState";
import { PixelUpdate } from "../crdt/types";
import path from "path";
import { initRedis, redis } from "./redis";
import { getAssignedVariant, logExposure, logEvent } from "./middleware/abTesting";

const app = express();
const useRedis = process.env.USE_REDIS !== "false" && !!process.env.REDIS_URL;

(async () => {
    const { setupAuth } = await import("./auth");
    setupAuth(app);

    await initRedis();

    const server = createServer(app);
    const wss = new WebSocketServer({ server });
    const canvas = new CanvasState();

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

    app.use(express.static(path.resolve(__dirname, "../public")));
    app.get("/", (req, res) => {
        res.sendFile(path.join(__dirname, "../public", "test-client.html"));
    });

    interface AuthedSocket extends WebSocket {
        userId?: string;
    }

    wss.on("connection", (ws: AuthedSocket) => {
        console.log("Client connected");

        ws.on("message", async (msg) => {
            try {
                const data = JSON.parse(msg.toString());

                switch (data.type) {
                    case "AUTH": {
                        const payload: any = jwt.decode(data.idToken);
                        ws.userId = data.analyticsId ||
                            payload?.sub ||
                            `anon-${Math.random().toString(36).slice(2, 8)}`;

                        const variant = getAssignedVariant(ws.userId!, "pixel_size_test");
                        if (variant) {
                            logExposure(ws.userId!, "pixel_size_test", variant);
                        }

                        ws.send(JSON.stringify({
                            type: "AUTH_ACK",
                            userId: ws.userId,
                            variant: variant
                        }));

                        ws.send(JSON.stringify({ type: "SNAPSHOT", pixels: canvas.getAll() }));
                        break;
                    }

                    case "PixelUpdate": {
                        if (!ws.userId) return;
                        const update: PixelUpdate = { ...data, userId: ws.userId };
                        const applied = canvas.apply(update);
                        ws.send(JSON.stringify({ type: "Ack", opId: data.opId }));

                        if (applied) {
                            const variant = getAssignedVariant(ws.userId, "pixel_size_test");
                            if (variant) {
                                logEvent(ws.userId, "pixel_placed", variant);
                            }

                            await savePixel(update);

                            for (const client of wss.clients) {
                                if (client !== ws && client.readyState === WebSocket.OPEN) {
                                    client.send(JSON.stringify({ type: "PixelUpdate", ...update }));
                                }
                            }
                        }
                        break;
                    }
                    case "BatchUpdate": {
                        if (!ws.userId) return;

                        const variant = getAssignedVariant(ws.userId, "pixel_size_test");

                        for (const update of data.updates) {
                            const fullUpdate = { ...update, userId: ws.userId };
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
                        break;
                    }

                    case "CURSOR": {
                        if (!ws.userId) return;
                        const cursorMsg = {
                            type: "CURSOR",
                            userId: ws.userId,
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
