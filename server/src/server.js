// @ts-nocheck
import 'dotenv/config'; // Load env vars first
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
                const owner = await redisClient.get(key);
                if (owner === socket.id) {
                    // Refresh our own lock
                    await redisClient.expire(key, LOCK_TTL);
                    lockedSuccessfully.push(item);
                } else {
                    conflict.push(item);
                }
            } else {
                lockedSuccessfully.push(item);
            }
        }

        if (conflict.length > 0) {
            // Roll back all locks acquired in this attempt
            for (const item of lockedSuccessfully) {
                await redisClient.del(`lock:${item.seatId}:${item.date}:${item.timeSlot}`);
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
            const owner = await redisClient.get(key);
            if (owner === socket.id) {
                await redisClient.del(key);
            }
        }

        socket.broadcast.emit("seats_locked_update", {
            cartItems: cart,
            status: "AVAILABLE",
            lockedBy: null
        });
    });

    // 3. DISCONNECT — Abandoned locks expire automatically via Redis TTL
    socket.on("disconnect", () => {
        console.log(`🔴 User disconnected: ${socket.id}. Locks will expire via TTL.`);
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});