
import { createClient } from "redis";

export const redis = createClient({
    url: process.env.REDIS_URL,
});

let connected = false;
export async function initRedis() {
    if (!connected) {
        try {
            await redis.connect();
            connected = true;
            console.log("Connected to Redis Cloud (non-TLS)");
        } catch (err) {
            console.error("Redis connection failed:", err);
        }
    }
}