// @ts-nocheck
import 'dotenv/config'; // Load env vars first
import dotenv from "dotenv";
dotenv.config({ override: true }); // Force reload from .env in case of nodemon cache
import express from "express";
import http from "http";
import mongoose from "mongoose";
import { Server } from "socket.io";
import cors from "cors";
import redisClient from "./redisClient.js";
import pricingRoutes from "./routes/pricingRoutes.js";
import bookingRoutes from "./routes/bookingRoutes.js";
import chatRoutes from "./routes/chatRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import authRoutes from './routes/authRoutes.js';
import { initPostgres } from './db/postgres.js';
import jwt from "jsonwebtoken";

// --- CONNECT TO POSTGRES ---
initPostgres();

// --- CONNECT TO MONGODB ---
mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/netcafe_db")
    .then(() => console.log("✅ Connected to MongoDB"))
    .catch((err) => console.error("❌ MongoDB Connection Error", err));

const app = express();
const server = http.createServer(app);

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

app.use(cors({ origin: FRONTEND_URL, methods: ["GET", "POST", "PUT", "DELETE", "PATCH"] }));
app.use(express.json());

// --- API ROUTES ---
app.use("/api/chat", chatRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/pricing", pricingRoutes);
app.use("/api/admin", adminRoutes);
app.use('/api/auth', authRoutes);

// --- SOCKET.IO ---
export const io = new Server(server, {
    cors: {
        origin: FRONTEND_URL,
        methods: ["GET", "POST"]
    }
});

// Redis lock TTL in seconds (5 minutes to complete checkout)
const LOCK_TTL = 120;

// The canonical atomic compare-and-delete Lua script
const UNLOCK_LUA_SCRIPT = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
    else
        return 0
    end
`;

io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
        return next(new Error("Authentication error"));
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.user = decoded;
        next();
    } catch (err) {
        next(new Error("Authentication error"));
    }
});

io.on("connection", (socket) => {
    console.log(`🟢 User connected: ${socket.id}`);

    // 1. ATTEMPT LOCK — Atomic multi-seat reservation
    socket.on("attempt_lock", async ({ cart }, callback) => {
        const conflict = [];
        const lockedSuccessfully = [];

        for (const item of cart) {
            const key = `lock:${item.seatId}:${item.date}:${item.timeSlot}`;
            const acquired = await redisClient.set(key, socket.id, { NX: true, EX: LOCK_TTL });

            if (!acquired) {
                // If it wasn't acquired, check if WE already own it
                const owner = await redisClient.get(key);
                if (owner !== socket.id) {
                    conflict.push(item);
                } else {
                    // We already own it, renew the lock
                    await redisClient.expire(key, 120);
                    lockedSuccessfully.push(item);
                }
            } else {
                lockedSuccessfully.push(item);
                if (!socket.locks) socket.locks = new Set();
                socket.locks.add(key);
            }
        }

        if (conflict.length > 0) {
            // Roll back all locks acquired in this attempt
            for (const item of lockedSuccessfully) {
                const key = `lock:${item.seatId}:${item.date}:${item.timeSlot}`;
                const result = await redisClient.eval(UNLOCK_LUA_SCRIPT, {
                    keys: [key],
                    arguments: [socket.id]
                });
                if (result === 1 && socket.locks) {
                    socket.locks.delete(key);
                }
            }
            callback({ success: false, conflict });
        } else {
            socket.broadcast.emit("seats_locked_update", {
                cartItems: cart,
                status: "LOCKED",
                lockedBy: socket.id
            });
            callback({ success: true });
        }
    });

    // 2. UNLOCK SEATS — When user cancels checkout
    socket.on("unlock_seats", async ({ cart }) => {
        for (const item of cart) {
            const key = `lock:${item.seatId}:${item.date}:${item.timeSlot}`;
            const result = await redisClient.eval(UNLOCK_LUA_SCRIPT, {
                keys: [key],
                arguments: [socket.id]
            });
            if (result === 1) {
                if (socket.locks) socket.locks.delete(key);
            }
        }

        socket.broadcast.emit("seats_locked_update", {
            cartItems: cart,
            status: "AVAILABLE",
            lockedBy: null
        });
    });

    // 3. DISCONNECT — Clear locks immediately instead of waiting for TTL
    socket.on("disconnect", async () => {
        console.log(`🔌 User disconnected: ${socket.id}. Clearing locks...`);
        if (socket.locks && socket.locks.size > 0) {
            for (const key of socket.locks) {
                // This executes atomically on the Redis server in a single round-trip
                const result = await redisClient.eval(UNLOCK_LUA_SCRIPT, {
                    keys: [key],
                    arguments: [socket.id] 
                });

                // result === 1 means it was deleted. result === 0 means we didn't own it.
                if (result === 1) {
                    const parts = key.split(':');
                    if (parts.length >= 4) {
                        const seatId = parts[1];
                        const date = parts[2];
                        const timeSlot = parts.slice(3).join(':'); 
                        
                        socket.broadcast.emit("seats_locked_update", {
                            cartItems: [{ seatId, date, timeSlot }],
                            status: "AVAILABLE",
                            lockedBy: null
                        });
                    }
                }
            }
        }
    });
});

const PORT = process.env.PORT || 5000;

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use.`);
        process.exit(1);
    } else {
        console.error('Server error:', err);
    }
});

server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});