import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";
import { CanvasState } from "../crdt/CanvasState";
import { PixelUpdate } from "../crdt/types";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const canvas = new CanvasState();

app.use(express.static(path.join(__dirname, "../../public")));

interface AuthedSocket extends WebSocket {
    userId?: string;
}

wss.on("connection", (ws: AuthedSocket) => {
    console.log("Client connected");

    ws.on("message", (msg) => {
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
                    for (const client of wss.clients) {
                        if (client.readyState === WebSocket.OPEN)
                            client.send(JSON.stringify({ type: "CLEAR" }));
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
