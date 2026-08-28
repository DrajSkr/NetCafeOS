//@ts-nocheck
import express from "express";
import { Booking } from "../models/Booking.js";
import { Tier } from "../models/Tier.js";
import { io } from "../server.js";
import redisClient from "../redisClient.js";
import Razorpay from "razorpay";
import crypto from "crypto";
import { verifyUser } from "../middleware/authMiddleware.js";

const router = express.Router();

const razorpayInstance = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// --- SHARED HELPERS ---

/**
 * Maps a seatId prefix to its tier name.
 * DRY helper used in both order creation and booking verification.
 * @param {string} seatId - e.g. "ECO_001", "STD_002", "PRO_003", "LUX_01"
 * @returns {string} - Tier name: "ECONOMY" | "STANDARD" | "PRO" | "LUXURY"
 */
function getTierName(seatId) {
    const prefix = seatId.split("_")[0];
    const tierMap = {
        ECO: "ECONOMY",
        STD: "STANDARD",
        PRO: "PRO",
        LUX: "LUXURY"
    };
    return tierMap[prefix] || "STANDARD";
}

/**
 * Fetches pricing from DB and calculates the server-authoritative total for a cart.
 * @param {Array} cart - Array of cart items with seatId
 * @returns {{ processedItems: Array, finalTotal: number }}
 */
async function calculateCartTotal(cart) {
    const tiers = await Tier.find();
    const pricingMap = tiers.reduce((acc, tier) => {
        acc[tier.name] = tier.price;
        return acc;
    }, {});

    let finalTotal = 0;
    const processedItems = cart.map(item => {
        const tierName = getTierName(item.seatId);
        const securePrice = pricingMap[tierName] || 80;
        finalTotal += securePrice;
        return {
            seatId: item.seatId,
            timeSlot: item.timeSlot,
            date: item.date,
            price: securePrice
        };
    });

    return { processedItems, finalTotal };
}

/**
 * Deletes all Redis locks for a given cart using the 3-part key format.
 * @param {Array} cart
 */
async function releaseCartLocks(cart) {
    for (const item of cart) {
        await redisClient.del(`lock:${item.seatId}:${item.date}:${item.timeSlot}`);
    }
}

// --- ROUTES ---

// GET /api/bookings/my-history — Fetch order history for the logged-in user
router.get("/my-history", verifyUser, async (req, res) => {
    try {
        const userEmail = req.user.email;
        const bookings = await Booking.find({ userId: userEmail }).sort({ date: -1 });
        return res.json({ success: true, bookings });
    } catch (error) {
        console.error("History fetch error:", error);
        return res.status(500).json({ error: "Failed to fetch order history" });
    }
});

// GET /api/bookings/status — Get seat availability for a given date + timeslot
router.get("/status", async (req, res) => {
    try {
        const { date, timeSlots } = req.query;

        if (!date || !timeSlots) {
            return res.status(400).json({ error: "Date and timeSlots are required" });
        }

        const times = timeSlots.split(",");
        let bookedStations = [];
        let lockedStations = [];

        // 1. MONGODB: Fetch confirmed/completed bookings
        const confirmedBookings = await Booking.find({
            status: { $in: ["CONFIRMED", "COMPLETED", "PAID", "SUCCESS"] },
            "items.date": date,
            "items.timeSlot": { $in: times }
        });

        confirmedBookings.forEach(booking => {
            (booking.items || []).forEach(item => {
                if (item.date === date && times.includes(item.timeSlot)) {
                    bookedStations.push(item.seatId);
                }
            });
        });

        // 2. REDIS: Fetch temporary checkout locks using 3-part key
        for (const time of times) {
            const keys = await redisClient.keys(`lock:*:${date}:${time}`);
            keys.forEach(key => {
                const parts = key.split(":");
                const seatId = parts[1];
                if (!bookedStations.includes(seatId)) {
                    lockedStations.push(seatId);
                }
            });
        }

        res.json({
            success: true,
            bookedStations: [...new Set(bookedStations)],
            lockedStations: [...new Set(lockedStations)]
        });
    } catch (error) {
        console.error("Status check failed:", error);
        res.status(500).json({ error: "Failed to fetch status" });
    }
});

// POST /api/bookings/create-order — Creates a Razorpay order
router.post("/create-order", verifyUser, async (req, res) => {
    try {
        const { cart } = req.body;
        if (!cart || cart.length === 0) {
            return res.status(400).json({ error: "Cart is empty" });
        }

        const { finalTotal } = await calculateCartTotal(cart);

        const order = await razorpayInstance.orders.create({
            amount: finalTotal * 100, // Razorpay expects paise
            currency: "INR",
            receipt: `rcpt_${Date.now()}`
        });

        res.json({ success: true, order, finalTotal });
    } catch (error) {
        console.error("Order creation failed:", error);
        res.status(500).json({ error: "Failed to create payment order" });
    }
});

// POST /api/bookings/verify — Verifies Razorpay signature and finalizes booking
router.post("/verify", verifyUser, async (req, res) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            cart,
            finalTotal
        } = req.body;

        const userId = req.user.email; // Authoritative email from validated JWT token

        // Cryptographic signature verification (MUST NOT BE SKIPPED)
        const body = `${razorpay_order_id}|${razorpay_payment_id}`;
        const expectedSignature = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
            .update(body)
            .digest("hex");

        if (expectedSignature !== razorpay_signature) {
            return res.status(400).json({ error: "Invalid payment signature." });
        }

        const { processedItems } = await calculateCartTotal(cart);

        const newBooking = new Booking({
            items: processedItems,
            userId: userId || "Guest",
            totalPrice: finalTotal,
            status: "COMPLETED"
        });
        await newBooking.save();

        // Release Redis locks using the correct 3-part key
        await releaseCartLocks(cart);

        // Broadcast seat status update to all connected clients
        io.emit("seats_locked_update", {
            cartItems: cart,
            status: "BOOKED",
            lockedBy: "SYSTEM"
        });

        res.json({ success: true, bookingId: newBooking._id });
    } catch (error) {
        console.error("Verification error:", error);
        res.status(500).json({ error: "Payment verification failed" });
    }
});

export default router;