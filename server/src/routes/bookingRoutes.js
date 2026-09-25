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

// We will instantiate this inside the routes to ensure it picks up the latest process.env
// after dotenv.config({ override: true }) has run in server.js
let razorpayInstance = null;
const getRazorpayInstance = () => {
    if (!razorpayInstance) {
        razorpayInstance = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET
        });
    }
    return razorpayInstance;
};

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

/**
 * Validates that all cart items are for future time slots.
 * @param {Array} cart
 * @returns {boolean}
 */
function validateFutureCart(cart) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayStr = `${yyyy}-${mm}-${dd}`;
    
    const currentTotalMins = today.getHours() * 60 + today.getMinutes();

    for (const item of cart) {
        if (item.date < todayStr) return false;
        if (item.date === todayStr) {
            const [time] = item.timeSlot.split('-');
            const [slotHour, slotMinute] = time.split(':').map(Number);
            const slotTotalMins = slotHour * 60 + slotMinute;
            
            // Allow a 15 minute grace period to allow for checkout time at hour boundaries
            if (slotTotalMins + 15 < currentTotalMins) return false;
        }
    }
    return true;
}

// --- ROUTES ---

// GET /api/bookings/my-history — Fetch order history for the logged-in user
router.get("/my-history", verifyUser, async (req, res) => {
    try {
        const userEmail = req.user.email;
        const bookings = await Booking.find({ 
            userId: userEmail,
            status: { $ne: "PENDING" }
        }).sort({ date: -1 });
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
            "items.timeSlot": { $in: times }
        });

        confirmedBookings.forEach(booking => {
            (booking.items || []).forEach(item => {
                const itemDate = item.date || (booking.date ? new Date(booking.date).toISOString().split('T')[0] : null);
                if ((!itemDate || itemDate === date) && times.includes(item.timeSlot)) {
                    bookedStations.push(item.seatId);
                }
            });
        });

        // 2. REDIS: Fetch temporary checkout locks using SCAN to avoid blocking
        for (const time of times) {
            let cursor = 0;
            do {
                const reply = await redisClient.scan(cursor, {
                    MATCH: `lock:*:${date}:${time}`,
                    COUNT: 100
                });
                
                cursor = reply.cursor;
                reply.keys.forEach(key => {
                    const parts = key.split(":");
                    const seatId = parts[1];
                    if (!bookedStations.includes(seatId)) {
                        lockedStations.push(seatId);
                    }
                });
            } while (cursor !== 0);
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

        if (!validateFutureCart(cart)) {
            return res.status(400).json({ error: "Cannot book past time slots." });
        }

        // ── Pre-payment conflict check ──────────────────────────────────────
        // Validate BEFORE touching Razorpay. If any seat is already COMPLETED/CONFIRMED
        // in MongoDB, reject immediately so no payment is ever initiated.
        const preConflict = await Booking.findOne({
            status: { $in: ["CONFIRMED", "COMPLETED", "PAID", "SUCCESS"] },
            items: {
                $elemMatch: {
                    $or: cart.map(item => ({
                        seatId: item.seatId,
                        date: item.date,
                        timeSlot: item.timeSlot
                    }))
                }
            }
        });

        if (preConflict) {
            // Find which specific seats are conflicted to tell the user
            const conflictedSeats = cart
                .filter(item =>
                    (preConflict.items || []).some(b =>
                        b.seatId === item.seatId &&
                        b.date === item.date &&
                        b.timeSlot === item.timeSlot
                    )
                )
                .map(i => i.seatId)
                .join(", ");
            return res.status(409).json({
                error: `Seat(s) ${conflictedSeats} were just booked by someone else. Please re-select available seats.`
            });
        }
        // ───────────────────────────────────────────────────────────────────

        const { processedItems, finalTotal } = await calculateCartTotal(cart);

        const rzp = getRazorpayInstance();
        const order = await rzp.orders.create({
            amount: finalTotal * 100, // Razorpay expects paise
            currency: "INR",
            receipt: `rcpt_${Date.now()}`
        });

        const newBooking = new Booking({
            items: processedItems,
            userId: req.user.email,
            totalPrice: finalTotal,
            status: "PENDING",
            razorpayOrderId: order.id
        });
        await newBooking.save();

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

        if (!validateFutureCart(cart)) {
            return res.status(400).json({ error: "Cannot book past time slots." });
        }

        const userId = req.user.email;

        // Cryptographic signature verification (MUST NOT BE SKIPPED)
        const body = `${razorpay_order_id}|${razorpay_payment_id}`;
        const expectedSignature = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
            .update(body)
            .digest("hex");

        if (expectedSignature !== razorpay_signature) {
            return res.status(400).json({ error: "Invalid payment signature." });
        }

        const booking = await Booking.findOne({ razorpayOrderId: razorpay_order_id });
        if (!booking) {
            return res.status(404).json({ error: "Booking not found." });
        }

        if (booking.status !== "PENDING") {
            return res.json({ success: true, bookingId: booking._id, status: booking.status });
        }

        // Check for conflicts
        const conflictQuery = {
            status: { $in: ["CONFIRMED", "COMPLETED", "PAID", "SUCCESS"] },
            "items": {
                $elemMatch: {
                    $or: booking.items.map(item => ({
                        seatId: item.seatId,
                        date: item.date,
                        timeSlot: item.timeSlot
                    }))
                }
            }
        };

        const conflict = await Booking.findOne(conflictQuery);

        if (conflict) {
            const rzp = getRazorpayInstance();
            await rzp.payments.refund(razorpay_payment_id, { amount: booking.totalPrice * 100 });
            booking.status = "REFUNDED";
            booking.razorpayPaymentId = razorpay_payment_id;
            await booking.save();
            return res.status(409).json({ error: "Seat was already booked by someone else. Payment has been refunded." });
        }

        booking.status = "COMPLETED";
        booking.razorpayPaymentId = razorpay_payment_id;
        await booking.save();

        // Release Redis locks using the correct 3-part key
        await releaseCartLocks(booking.items);

        // Broadcast seat status update to all connected clients
        io.emit("seats_locked_update", {
            cartItems: booking.items,
            status: "BOOKED",
            lockedBy: "SYSTEM"
        });

        res.json({ success: true, bookingId: booking._id });
    } catch (error) {
        console.error("Verification error:", error);
        res.status(500).json({ error: "Payment verification failed" });
    }
});

// POST /api/bookings/webhook — Razorpay Webhook
router.post("/webhook", async (req, res) => {
    try {
        const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
        const signature = req.headers["x-razorpay-signature"];

        // req.body is a raw Buffer because of express.raw() in server.js
        const rawBody = req.body;

        if (webhookSecret && signature) {
            const expectedSignature = crypto
                .createHmac("sha256", webhookSecret)
                .update(rawBody)
                .digest("hex");
            
            if (expectedSignature !== signature) {
                console.error("Webhook signature mismatch.");
                return res.status(400).json({ error: "Invalid signature" });
            }
        }

        // Parse the body now that signature is verified
        const payload = JSON.parse(rawBody.toString());
        const event = payload.event;
        
        if (event === "payment.captured" || event === "order.paid") {
            const paymentEntity = payload.payload.payment.entity;
            const razorpay_order_id = paymentEntity.order_id;
            const razorpay_payment_id = paymentEntity.id;

            const booking = await Booking.findOne({ razorpayOrderId: razorpay_order_id });
            if (booking && booking.status === "PENDING") {
                const conflictQuery = {
                    status: { $in: ["CONFIRMED", "COMPLETED", "PAID", "SUCCESS"] },
                    "items": {
                        $elemMatch: {
                            $or: booking.items.map(item => ({
                                seatId: item.seatId,
                                date: item.date,
                                timeSlot: item.timeSlot
                            }))
                        }
                    }
                };
                
                const conflict = await Booking.findOne(conflictQuery);
                if (conflict) {
                    const rzp = getRazorpayInstance();
                    await rzp.payments.refund(razorpay_payment_id, { amount: booking.totalPrice * 100 });
                    booking.status = "REFUNDED";
                    booking.razorpayPaymentId = razorpay_payment_id;
                    await booking.save();
                    console.log(`Refunded booking ${booking._id} due to conflict.`);
                } else {
                    booking.status = "COMPLETED";
                    booking.razorpayPaymentId = razorpay_payment_id;
                    await booking.save();

                    await releaseCartLocks(booking.items);
                    io.emit("seats_locked_update", {
                        cartItems: booking.items,
                        status: "BOOKED",
                        lockedBy: "SYSTEM"
                    });
                    console.log(`Completed booking ${booking._id} via webhook.`);
                }
            }
        }
        res.status(200).json({ status: "ok" });
    } catch (error) {
        console.error("Webhook error:", error);
        res.status(500).json({ error: "Webhook processing failed" });
    }
});

export default router;