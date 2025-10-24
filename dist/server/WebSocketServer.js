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
// server/WebSocketServer.ts (or .js)
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const ws_1 = require("ws");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const CanvasState_1 = require("../crdt/CanvasState");
const path_1 = __importDefault(require("path"));
const app = (0, express_1.default)();
(async () => {
    // If using TS, use: const { setupAuth } = await import("./auth");
    const { setupAuth } = await Promise.resolve().then(() => __importStar(require("./auth.js")));
    setupAuth(app);
    const server = (0, http_1.createServer)(app);
    const wss = new ws_1.WebSocketServer({ server });
    const canvas = new CanvasState_1.CanvasState();
    app.use(express_1.default.static(path_1.default.resolve(__dirname, "../public")));
    app.get("/", (req, res) => {
        res.sendFile(path_1.default.join(__dirname, "../public", "test-client.html"));
    });
    wss.on("connection", (ws) => {
        console.log("Client connected");
        ws.on("message", (msg) => {
            try {
                const data = JSON.parse(msg.toString());
                switch (data.type) {
                    case "AUTH": {
                        const payload = jsonwebtoken_1.default.decode(data.idToken);
                        ws.userId =
                            payload?.sub ?? `anon-${Math.random().toString(36).slice(2, 8)}`;
                        ws.send(JSON.stringify({ type: "AUTH_ACK", userId: ws.userId }));
                        ws.send(JSON.stringify({ type: "SNAPSHOT", pixels: canvas.getAll() }));
                        break;
                    }
                    case "PixelUpdate": {
                        if (!ws.userId)
                            return;
                        const update = { ...data, userId: ws.userId };
                        const applied = canvas.apply(update);
                        ws.send(JSON.stringify({ type: "Ack", opId: data.opId }));
                        if (applied) {
                            for (const client of wss.clients) {
                                if (client !== ws && client.readyState === ws_1.WebSocket.OPEN) {
                                    client.send(JSON.stringify({ type: "PixelUpdate", ...update }));
                                }
                            }
                        }
                        break;
                    }
                    case "CURSOR": {
                        if (!ws.userId)
                            return;
                        const cursorMsg = {
                            type: "CURSOR",
                            userId: ws.userId,
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
                        for (const client of wss.clients) {
                            if (client.readyState === ws_1.WebSocket.OPEN) {
                                client.send(JSON.stringify({ type: "CLEAR" }));
                            }
                        }
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
