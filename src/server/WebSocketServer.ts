import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import jwt from "jsonwebtoken";
import { CanvasState } from "../crdt/CanvasState";
import { PixelUpdate } from "../crdt/types";
import path from "path";
import { initRedis, redis } from "./redis"; // ✅ NEW

const app = express();

(async () => {
    const { setupAuth } = await import("./auth.js");
    setupAuth(app);

    await initRedis();

    const server = createServer(app);
    const wss = new WebSocketServer({ server });
    const canvas = new CanvasState();
    async function loadCanvas() {
        const data = await redis.hGetAll("canvas:default:pixels");
        for (const field in data) {
            const pixel = JSON.parse(data[field]) as PixelUpdate;
            canvas.apply(pixel);
        }
        console.log(`Loaded ${Object.keys(data).length} pixels from Redis`);
    }
    await loadCanvas();

    async function savePixel(update: PixelUpdate) {
        const field = `${update.x}:${update.y}`;
        await redis.hSet("canvas:default:pixels", field, JSON.stringify(update));
    }

    async function clearCanvas() {
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
                        ws.userId =
                            payload?.sub ?? `anon-${Math.random().toString(36).slice(2, 8)}`;
                        ws.send(JSON.stringify({ type: "AUTH_ACK", userId: ws.userId }));

                        ws.send(JSON.stringify({ type: "SNAPSHOT", pixels: canvas.getAll() }));
                        break;
                    }

                    case "PixelUpdate": {
                        if (!ws.userId) return;
                        const update: PixelUpdate = { ...data, userId: ws.userId };
                        const applied = canvas.apply(update);
                        ws.send(JSON.stringify({ type: "Ack", opId: data.opId }));

                        if (applied) {
                            await savePixel(update);

                            for (const client of wss.clients) {
                                if (client !== ws && client.readyState === WebSocket.OPEN) {
                                    client.send(JSON.stringify({ type: "PixelUpdate", ...update }));
                                }
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
