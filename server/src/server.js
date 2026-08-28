// @ts-nocheck
import 'dotenv/config'; // MUST BE LINE 1
import express from "express";
import { Booking } from "./models/Booking.js";
// ...
// import express from "express";
import http from "http";
import mongoose from "mongoose";
import { Server } from "socket.io";
import cors from "cors";
import pricingRoutes from "./routes/pricingRoutes.js";
import dotenv from "dotenv";
import redisClient from "./redisClient.js";
import bookingRoutes from "./routes/bookingRoutes.js"; // Optional: if you made this file earlier
import chatRoutes from "./routes/chatRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import authRoutes from './routes/authRoutes.js';

// dotenv.config();

// --- CONNECT TO MONGODB ---
mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/netcafe_db")
    .then(() => console.log("Connected to MongoDB"))
    .catch((err) => console.error("MongoDB Connection Error", err));

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());
// Mount the routes
app.use("/api/chat", chatRoutes);
app.use("/api/bookings", bookingRoutes);
// Add this where your other app.use() routes are:
app.use("/api/pricing", pricingRoutes);
app.use("/api/admin", adminRoutes);
app.use('/api/auth', authRoutes);

// Initialize Socket.io for real-time bidirectional communication
export const io = new Server(server, {
  cors: {
    origin: "*", // Allows your React frontend to connect
    methods: ["GET", "POST"]
  }
});

const LOCK_TTL = 300; // Time-to-Live: 120 seconds


io.on("connection", (socket) => {
	console.log(`User connected: ${socket.id}`);

	// --- server.js ---

    // 1. ATTEMPT LOCK (4D Matrix Upgrade)
        socket.on("attempt_lock", async ({ cart }, callback) => {
            const conflict = [];
            const lockedSuccessfully = [];

            for (const item of cart) {
                // Injecting item.date into the Redis Key
                const key = `lock:${item.seatId}:${item.date}:${item.timeSlot}`;
                
                const acquired = await redisClient.set(key, socket.id, { NX: true, EX: 120 });
                
                if (!acquired) {
                    const owner = await redisClient.get(key);
                    if (owner === socket.id) {
                        await redisClient.expire(key, 120);
                        lockedSuccessfully.push(item);
                    } else {
                        conflict.push(item);
                    }
                } else {
                    lockedSuccessfully.push(item);
                }
            }

            if (conflict.length > 0) {
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

        // 2. UNLOCK SEATS (4D Matrix Upgrade)
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

	// 3. The Rage-Quit Release
    socket.on("disconnect", () => {
        console.log(`User disconnected: ${socket.id}. Abandoned locks will expire automatically via Redis TTL.`);
    });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});