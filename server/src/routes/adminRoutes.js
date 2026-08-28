//@ts-nocheck
import express from "express";
import { Booking } from "../models/Booking.js";
import redisClient from "../redisClient.js";
import { verifyAdmin } from "../middleware/authMiddleware.js"; // <-- Import the middleware

const router = express.Router();

// GET Admin Dashboard Stats
router.get("/dashboard",verifyAdmin, async (req, res) => {
    try {
        // 1. Get total revenue using MongoDB Aggregation
        const revenueStats = await Booking.aggregate([
            { $match: { status: "COMPLETED" } },
            { $group: { _id: null, totalRevenue: { $sum: "$totalPrice" }, totalBookings: { $sum: 1 } } }
        ]);

        const totalRevenue = revenueStats.length > 0 ? revenueStats[0].totalRevenue : 0;
        const totalBookings = revenueStats.length > 0 ? revenueStats[0].totalBookings : 0;

        // 2. Count active people checking out right now (Redis Locks)
        const activeLocks = await redisClient.keys("lock:*");

        // 3. Fetch the latest 10 transactions
        const recentBookings = await Booking.find()
            .sort({ date: -1 })
            .limit(10);

        return res.json({
            success: true,
            stats: {
                totalRevenue,
                totalBookings,
                activeCheckouts: activeLocks.length,
            },
            recentBookings
        });

    } catch (error) {
        console.error("Admin dashboard error:", error);
        res.status(500).json({ error: "Failed to fetch admin stats" });
    }
});

// POST /api/admin/rules - Add a new rule to the AI's brain
router.post("/rules", verifyAdmin, async (req, res) => {
    try {
        const { text } = req.body;
        
        // 1. Generate the embedding for the new rule
        const embedRes = await fetch("http://localhost:11434/api/embeddings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: "nomic-embed-text", prompt: text })
        });
        const embedData = await embedRes.json();

        // 2. Save it to MongoDB
        const newRule = new RuleChunk({
            content: text,
            embedding: embedData.embedding
        });
        await newRule.save();

        res.json({ success: true, message: "New rule injected into AI brain." });
    } catch (error) {
        res.status(500).json({ error: "Failed to save rule." });
    }
});

export default router;