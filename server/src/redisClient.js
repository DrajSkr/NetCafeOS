import { createClient } from "redis";

const redisClient = createClient({
    url: process.env.REDIS_URI || "redis://localhost:6379"
});

redisClient.on("error", (err) => console.error("Redis Client Error", err));
redisClient.on("connect", () => console.log("Connected to Redis"));

// Connect immediately
await redisClient.connect();

export default redisClient;