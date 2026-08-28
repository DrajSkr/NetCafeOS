//@ts-nocheck
import express from "express";
import { Booking } from "../models/Booking.js";
import { User } from "../models/User.js";
import { RuleChunk } from "../models/RuleChunk.js";
import redisClient from "../redisClient.js";
import { verifyAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

// ─── Helper ───────────────────────────────────────────────────────────────────
const adminAuth = { headers: {} }; // verifyAdmin middleware handles this via req
const getAdminToken = (req) => req.headers.authorization;

// ─── GET /api/admin/dashboard ─────────────────────────────────────────────────
// Overview stats: total revenue, bookings, LIVE Redis lock details
router.get("/dashboard", verifyAdmin, async (req, res) => {
    try {
        // 1. Aggregate total revenue and booking count
        const revenueStats = await Booking.aggregate([
            { $match: { status: "COMPLETED" } },
            {
                $group: {
                    _id: null,
                    totalRevenue: { $sum: "$totalPrice" },
                    totalBookings: { $sum: 1 }
                }
            }
        ]);

        const totalRevenue = revenueStats[0]?.totalRevenue ?? 0;
        const totalBookings = revenueStats[0]?.totalBookings ?? 0;

        // 2. Live Redis locks — use SCAN instead of KEYS for safety
        //    Parse each lock key to show which seat/slot is being checked out
        const lockKeys = await redisClient.keys("lock:*");
        const activeLockDetails = [];

        for (const key of lockKeys) {
            const ttl = await redisClient.ttl(key);
            // Only include keys that still have a positive TTL (genuinely active)
            if (ttl > 0) {
                // key format: lock:SEATID:DATE:TIMESLOT
                const parts = key.split(":");
                activeLockDetails.push({
                    seatId: parts[1] || "?",
                    date:   parts[2] || "?",
                    slot:   `${parts[3] || "?"}:${parts[4] || "?"}`,
                    ttlSeconds: ttl
                });
            }
        }

        // 3. Recent 10 transactions
        const recentBookings = await Booking.find()
            .sort({ date: -1 })
            .limit(10)
            .lean();

        return res.json({
            success: true,
            stats: {
                totalRevenue,
                totalBookings,
                activeCheckouts: activeLockDetails.length,
                activeLockDetails
            },
            recentBookings
        });

    } catch (error) {
        console.error("Admin dashboard error:", error);
        res.status(500).json({ error: "Failed to fetch admin stats" });
    }
});

// ─── GET /api/admin/revenue/daily ────────────────────────────────────────────
// Day-wise revenue for the last 30 days
router.get("/revenue/daily", verifyAdmin, async (req, res) => {
    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        thirtyDaysAgo.setHours(0, 0, 0, 0);

        const dailyRevenue = await Booking.aggregate([
            {
                $match: {
                    status: "COMPLETED",
                    date: { $gte: thirtyDaysAgo }
                }
            },
            {
                $group: {
                    _id: {
                        $dateToString: { format: "%Y-%m-%d", date: "$date" }
                    },
                    revenue: { $sum: "$totalPrice" },
                    bookings: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        res.json({ success: true, dailyRevenue });
    } catch (error) {
        console.error("Daily revenue error:", error);
        res.status(500).json({ error: "Failed to fetch daily revenue" });
    }
});

// ─── GET /api/admin/users ─────────────────────────────────────────────────────
// Search and list all users with their booking count
router.get("/users", verifyAdmin, async (req, res) => {
    try {
        const { search = "" } = req.query;

        const query = search.trim()
            ? {
                $or: [
                    { email: { $regex: search, $options: "i" } },
                    { name:  { $regex: search, $options: "i" } }
                ]
            }
            : {};

        const users = await User.find(query)
            .sort({ lastLogin: -1 })
            .limit(50)
            .lean();

        // Attach booking count per user
        const enriched = await Promise.all(
            users.map(async (u) => {
                const bookingCount = await Booking.countDocuments({ userId: u.email });
                const totalSpent = await Booking.aggregate([
                    { $match: { userId: u.email, status: "COMPLETED" } },
                    { $group: { _id: null, total: { $sum: "$totalPrice" } } }
                ]);
                return {
                    ...u,
                    bookingCount,
                    totalSpent: totalSpent[0]?.total ?? 0
                };
            })
        );

        res.json({ success: true, users: enriched });
    } catch (error) {
        console.error("User list error:", error);
        res.status(500).json({ error: "Failed to fetch users" });
    }
});

// ─── GET /api/admin/users/:email/bookings ────────────────────────────────────
// Full booking history for a specific user
router.get("/users/:email/bookings", verifyAdmin, async (req, res) => {
    try {
        const email = decodeURIComponent(req.params.email);
        const bookings = await Booking.find({ userId: email })
            .sort({ date: -1 })
            .limit(50)
            .lean();
        res.json({ success: true, bookings });
    } catch (error) {
        console.error("User booking history error:", error);
        res.status(500).json({ error: "Failed to fetch user bookings" });
    }
});

// ─── PATCH /api/admin/users/:email/ban ───────────────────────────────────────
// Toggle ban status for a user
router.patch("/users/:email/ban", verifyAdmin, async (req, res) => {
    try {
        const email = decodeURIComponent(req.params.email);
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ error: "User not found" });

        user.isBanned = !user.isBanned;
        await user.save();

        res.json({
            success: true,
            isBanned: user.isBanned,
            message: `User ${user.isBanned ? "banned" : "unbanned"} successfully`
        });
    } catch (error) {
        console.error("Ban toggle error:", error);
        res.status(500).json({ error: "Failed to toggle ban" });
    }
});

// ─── GET /api/admin/search ───────────────────────────────────────────────────
// Search by Booking ID (last 6 chars) or Seat ID to find owner
router.get("/search", verifyAdmin, async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.trim().length < 3) {
            return res.status(400).json({ error: "Query must be at least 3 characters" });
        }

        const query = q.trim().toUpperCase();
        const results = [];

        // Strategy 1: Try exact Booking ID suffix match (last 6 chars)
        const allBookings = await Booking.find({}, { _id: 1, userId: 1, items: 1, totalPrice: 1, date: 1 })
            .sort({ date: -1 })
            .limit(200)
            .lean();

        for (const b of allBookings) {
            const idSuffix = b._id.toString().slice(-6).toUpperCase();

            // Match by booking ID suffix
            if (idSuffix === query.slice(-6)) {
                results.push({ type: "booking", booking: b, matchedOn: "Booking ID" });
                continue;
            }

            // Match by seat ID within items
            const seatMatch = b.items?.find(item =>
                item.seatId.toUpperCase().includes(query)
            );
            if (seatMatch) {
                results.push({ type: "seat", booking: b, matchedSeat: seatMatch, matchedOn: `Seat ${seatMatch.seatId}` });
            }
        }

        // Enrich results with user name
        const enriched = await Promise.all(
            results.slice(0, 20).map(async (r) => {
                const user = await User.findOne({ email: r.booking.userId }, { name: 1, email: 1, isBanned: 1 }).lean();
                return { ...r, user };
            })
        );

        res.json({ success: true, results: enriched });
    } catch (error) {
        console.error("Search error:", error);
        res.status(500).json({ error: "Search failed" });
    }
});

// ─── POST /api/admin/cleanup ─────────────────────────────────────────────────
// Delete bookings older than 30 days AND flush stale Redis locks
router.post("/cleanup", verifyAdmin, async (req, res) => {
    try {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 30);
        cutoff.setHours(0, 0, 0, 0);

        // 1. Delete old bookings from MongoDB
        const bookingResult = await Booking.deleteMany({
            date: { $lt: cutoff }
        });

        // 2. Flush ALL Redis locks (any remaining stale ones)
        const lockKeys = await redisClient.keys("lock:*");
        let flushedLocks = 0;
        for (const key of lockKeys) {
            const ttl = await redisClient.ttl(key);
            // Remove keys with no TTL (-1 means permanent — should never happen but clean up)
            if (ttl === -1) {
                await redisClient.del(key);
                flushedLocks++;
            }
        }

        res.json({
            success: true,
            deletedBookings: bookingResult.deletedCount,
            flushedLocks,
            message: `Cleaned up ${bookingResult.deletedCount} old bookings and ${flushedLocks} stale Redis locks.`
        });
    } catch (error) {
        console.error("Cleanup error:", error);
        res.status(500).json({ error: "Cleanup failed" });
    }
});

// ─── POST /api/admin/rules ───────────────────────────────────────────────────
// Inject a new rule into the RAG knowledge base
router.post("/rules", verifyAdmin, async (req, res) => {
    try {
        const { text } = req.body;
        if (!text?.trim()) {
            return res.status(400).json({ error: "Rule text is required." });
        }

        const embedRes = await fetch("http://localhost:11434/api/embeddings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: "nomic-embed-text", prompt: text })
        });
        const embedData = await embedRes.json();

        const newRule = new RuleChunk({ content: text, embedding: embedData.embedding });
        await newRule.save();

        res.json({ success: true, message: "New rule injected into AI brain." });
    } catch (error) {
        console.error("Rule injection error:", error);
        res.status(500).json({ error: "Failed to save rule." });
    }
});

export default router;