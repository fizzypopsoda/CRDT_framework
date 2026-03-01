import ws from "k6/ws";
import { check, sleep } from "k6";
import { Trend, Counter } from "k6/metrics";

// === METRICS ===

const connectTime = new Trend("connect_time");
const roundTrip = new Trend("round_trip_latency");
const messagesSent = new Counter("messages_sent")

// === TEST STAGES ===
export const options = {
    stages: [
        { duration: "30s", target: 500 },
        { duration: "30s", target: 750 },
        { duration: "30s", target: 1000 },
    ],
};

// === MAIN TEST ===
export default function () {
    const url = "ws://localhost:8080"; // Use "wss://crdt-framework.onrender.com" if testing deployed
    const params = { tags: { name: "CRDTCanvasWS" } };

    const start = Date.now();
    const res = ws.connect(url, params, function (socket) {
        const openTime = Date.now() - start;
        connectTime.add(openTime);

        socket.on("open", function () {
            socket.send(JSON.stringify({ type: "AUTH", idToken: "anon" }));
        });

        socket.on("message", function (msg) {
            const data = JSON.parse(msg);
            if (data.type === "SNAPSHOT") {
                // Simulate user drawing 5 pixels
                for (let i = 0; i < 5; i++) {
                    const sentAt = Date.now();
                    const op = {
                        type: "PixelUpdate",
                        x: Math.floor(Math.random() * 50),
                        y: Math.floor(Math.random() * 50),
                        color: "#ff0000",
                        opId: Math.random().toString(36).slice(2),
                        ts: sentAt,
                    };
                    socket.send(JSON.stringify(op));
                    messagesSent.add(1);

                    socket.on("message", (m2) => {
                        const r = JSON.parse(m2);
                        if (r.type === "Ack" && r.opId === op.opId) {
                            roundTrip.add(Date.now() - sentAt);
                        }
                    });

                    sleep(0.1);
                }
            }
        });

        socket.setTimeout(() => {
            socket.close();
        }, 15000);
    });

    check(res, { "status is 101": (r) => r && r.status === 101 });
}