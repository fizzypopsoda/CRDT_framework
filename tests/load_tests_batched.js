import ws from "k6/ws";
import { check, sleep } from "k6";
import { Trend, Counter } from "k6/metrics";

const roundTrip = new Trend("round_trip_latency_batch");
const batchesSent = new Counter("batches_sent");

export const options = {
    stages: [
        { duration: "15s", target: 10 },
        { duration: "30s", target: 50 },
        { duration: "30s", target: 150 },
        { duration: "1m", target: 300 },
    ],
};

export default function () {
    const url = "ws://localhost:8080";
    const res = ws.connect(url, {}, function (socket) {
        socket.on("open", () => socket.send(JSON.stringify({ type: "AUTH", idToken: "anon" })));

        socket.on("message", (msg) => {
            const data = JSON.parse(msg);
            if (data.type === "SNAPSHOT") {
                const sentAt = Date.now();
                const updates = Array.from({ length: 10 }, () => ({
                    type: "PixelUpdate",
                    x: Math.floor(Math.random() * 100),
                    y: Math.floor(Math.random() * 100),
                    color: "#00ff00",
                    opId: Math.random().toString(36).slice(2),
                    ts: sentAt,
                }));

                const batch = { type: "BatchUpdate", updates };
                socket.send(JSON.stringify(batch));
                batchesSent.add(1);

                socket.on("message", (m2) => {
                    const r = JSON.parse(m2);
                    if (r.type === "BatchUpdate") {
                        roundTrip.add(Date.now() - sentAt);
                    }
                });
            }
        });
    });
    check(res, { "status is 101": (r) => r && r.status === 101 });
}
