import { createClient } from 'redis';

export const redis = createClient({
    url: process.env.REDIS_URL,
    socket: {
        tls: true,
        rejectUnauthorized: false,
    },
});

let connected = false;
export async function initRedis() {
    if (!connected) {
        await redis.connect();
        connected = true;
        console.log("✅ Connected to Redis Cloud");
    }
}
