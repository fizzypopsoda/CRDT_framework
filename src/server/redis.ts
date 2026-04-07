import { createClient } from "redis";

export let redis: any = null;
let connected = false;

export async function initRedis() {
    if (process.env.USE_REDIS === "false") {
        console.warn("Redis disabled (in-memory mode only)");
        return;
    }

    try {
        const url = process.env.REDIS_URL || "redis://localhost:6379";
        redis = createClient({ url });
        await redis.connect();
        connected = true;
        console.log("Connected to Redis");
    } catch (err) {
        console.error("Redis connection failed:", err);
        console.warn("Continuing without Redis (in-memory mode)");
        connected = false;
        try {
            if (redis) await redis.disconnect();
        } catch {
            /* ignore */
        }
        redis = null;
    }
}