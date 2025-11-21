"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.redis = void 0;
exports.initRedis = initRedis;
const redis_1 = require("redis");
exports.redis = (0, redis_1.createClient)({
    url: process.env.REDIS_URL,
});
let connected = false;
async function initRedis() {
    if (!connected) {
        try {
            await exports.redis.connect();
            connected = true;
            console.log("Connected to Redis Cloud (non-TLS)");
        }
        catch (err) {
            console.error("Redis connection failed:", err);
        }
    }
}
