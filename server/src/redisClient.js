import { createClient } from "redis";

const redisClient = createClient({
    url: process.env.REDIS_URI || "redis://localhost:6379"
});

redisClient.on("error", (err) => console.error("Redis Client Error", err));
redisClient.on("connect", () => console.log("Connected to Redis"));

// Connect asynchronously so it doesn't block server startup (node-redis handles queueing/reconnecting)
redisClient.connect().catch((err) => console.error("❌ Redis Connection Error", err));

export default redisClient;