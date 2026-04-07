"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.redis = void 0;
exports.initRedis = initRedis;
const redis_1 = require("redis");
exports.redis = null;
let connected = false;
async function initRedis() {
    if (process.env.USE_REDIS === "false") {
        console.warn("Redis disabled (in-memory mode only)");
        return;
    }
    try {
        const url = process.env.REDIS_URL || "redis://localhost:6379";
        exports.redis = (0, redis_1.createClient)({ url });
        await exports.redis.connect();
        connected = true;
        console.log("Connected to Redis");
    }
    catch (err) {
        console.error("Redis connection failed:", err);
        console.warn("Continuing without Redis (in-memory mode)");
        connected = false;
        try {
            if (exports.redis)
                await exports.redis.disconnect();
        }
        catch {
            /* ignore */
        }
        exports.redis = null;
    }
}
