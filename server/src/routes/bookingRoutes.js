//@ts-nocheck
import express from "express";
import { Booking } from "../models/Booking.js";
import { Tier } from "../models/Tier.js";
import { io } from "../server.js"; 
import redisClient from "../redisClient.js"; // Import Redis directly
import Razorpay from "razorpay";
import crypto from "crypto";
import { verifyUser } from "../middleware/authMiddleware.js";

const router = express.Router();

const razorpayInstance = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// ADD THIS ROUTE: Fetch order history for the logged-in user
router.get("/my-history", verifyUser, async (req, res) => {
    try {
        const userEmail = req.user.email;
        // Find bookings, sort by newest first
        const bookings = await Booking.find({ userId: userEmail }).sort({ date: -1 });
        
        return res.json({ success: true, bookings });
    } catch (error) {
        console.error("History fetch error:", error);
        return res.status(500).json({ error: "Failed to fetch order history" });
    }
});

router.post("/", async (req, res) => {
    try {
        const { cart, userId } = req.body;

        if (!cart || cart.length === 0) return res.status(400).json({ error: "Cart is empty" });
        if (cart.length > 10) return res.status(400).json({ error: "Cart limit exceeded (Max 10)" });

        // 1. SECURE PRICING: Fetch real prices from the DB. Never trust the client.
        const tiers = await Tier.find();
        const pricingMap = tiers.reduce((acc, tier) => {
            acc[tier.name] = tier.price;
            return acc;
        }, {});

        let finalTotal = 0;
        const processedItems = [];

        // 2. Calculate the total securely on the server
        for (const item of cart) {
            const prefix = item.seatId.split("_")[0];
            let tierName = "STANDARD";
            
            if (prefix === "ECO") tierName = "ECONOMY";
            if (prefix === "PRO") tierName = "PRO";
            if (prefix === "LUX") tierName = "LUXURY";

            const securePrice = pricingMap[tierName] || 80; // Fallback to 80 if tier missing
            finalTotal += securePrice;

            processedItems.push({
                seatId: item.seatId,
                timeSlot: item.timeSlot,
                date: item.date, // <--- ADD THIS LINE SO YOU DONT LOSE IT
                price: securePrice 
            });
        }

        // 3. Save granular cart to Database
        const newBooking = new Booking({
            items: processedItems,
            userId: userId || "Guest",
            totalPrice: finalTotal,
            status: "COMPLETED"
        });
        await newBooking.save();

        // 4. Clear precise 3D matrix locks from Redis
        for (const item of cart) {
            await redisClient.del(`lock:${item.seatId}:${item.timeSlot}`);
        }

        // 5. Broadcast to all clients
        io.emit("seats_locked_update", {
            cartItems: cart, 
            status: "BOOKED",
            lockedBy: "SYSTEM"
        });

        return res.json({ success: true, bookingId: newBooking._id, totalPaid: finalTotal });

    } catch (error) {
        console.error("Booking checkout error:", error);
        return res.status(500).json({ error: "Checkout failed" });
    }
});

// GET /api/bookings/status
router.get("/status", async (req, res) => {
    try {
        const { date, timeSlots } = req.query;
        
        if (!date || !timeSlots) {
            return res.status(400).json({ error: "Date and timeSlots are required" });
        }

        const times = timeSlots.split(",");
        let bookedStations = []; // Permanent (Red)
        let lockedStations = []; // Temporary (Yellow)

        // 1. MONGODB: Find permanent bookings
        // Using $in to catch any variation of a successful payment status
        const confirmedBookings = await Booking.find({
            status: { $in: ["CONFIRMED", "COMPLETED", "PAID", "SUCCESS"] },
            $or: [
                { "items.date": date, "items.timeSlot": { $in: times } },
                { "cart.date": date, "cart.timeSlot": { $in: times } }
            ]
        });

        confirmedBookings.forEach(booking => {
            // Fallback in case your schema named the array 'cart' instead of 'items'
            const arrayToCheck = booking.items || booking.cart || [];
            
            arrayToCheck.forEach(item => {
                if (item.date === date && times.includes(item.timeSlot)) {
                    bookedStations.push(item.seatId);
                }
            });
        });

        // 2. REDIS: Find temporary checkout locks
        for (const time of times) {
            const keys = await redisClient.keys(`lock:*:${date}:${time}`);
            keys.forEach(key => {
                const parts = key.split(":"); // lock:ECO_001:2026-08-28:10:00-10:55
                const seatId = parts[1];
                
                // Only mark as locked if it hasn't already been fully booked
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

// 1. CREATE ORDER (Triggered when user clicks "Review & Checkout")
router.post("/create-order", async (req, res) => {
    try {
        const { cart } = req.body;
        if (!cart || cart.length === 0) return res.status(400).json({ error: "Cart is empty" });

        const tiers = await Tier.find();
        const pricingMap = tiers.reduce((acc, tier) => { acc[tier.name] = tier.price; return acc; }, {});

        let finalTotal = 0;
        cart.forEach(item => {
            const prefix = item.seatId.split("_")[0];
            let tierName = "STANDARD";
            if (prefix === "ECO") tierName = "ECONOMY";
            if (prefix === "PRO") tierName = "PRO";
            if (prefix === "LUX") tierName = "LUXURY";
            finalTotal += (pricingMap[tierName] || 80);
        });

        // Razorpay expects amount in paise (multiply by 100)
        const options = {
            amount: finalTotal * 100, 
            currency: "INR",
            receipt: `rcpt_${Date.now()}`
        };

        const order = await razorpayInstance.orders.create(options);
        res.json({ success: true, order, finalTotal });

    } catch (error) {
        console.error("Order creation failed:", error);
        res.status(500).json({ error: "Failed to create payment order" });
    }
});

// 2. VERIFY PAYMENT & SAVE BOOKING (Triggered after Razorpay success)
router.post("/verify", async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, cart, userId, finalTotal } = req.body;

        // Cryptographic Signature Verification (DO NOT SKIP THIS)
        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
            .update(body.toString())
            .digest("hex");

        if (expectedSignature !== razorpay_signature) {
            return res.status(400).json({ error: "Invalid payment signature. Scam detected." });
        }

        // If signature is valid, process the DB save
        const newBooking = new Booking({
            items: cart,
            userId: userId || "Guest",
            totalPrice: finalTotal,
            status: "COMPLETED"
        });
        await newBooking.save();

        // Inside router.post("/verify")
        // Ensure this loop inside your /verify route looks EXACTLY like this:
        for (const item of cart) {
            await redisClient.del(`lock:${item.seatId}:${item.date}:${item.timeSlot}`);
        }

        io.emit("seats_locked_update", { cartItems: cart, status: "BOOKED", lockedBy: "SYSTEM" });

        res.json({ success: true, bookingId: newBooking._id });

    } catch (error) {
        console.error("Verification error:", error);
        res.status(500).json({ error: "Payment verification failed" });
    }
});

export default router;