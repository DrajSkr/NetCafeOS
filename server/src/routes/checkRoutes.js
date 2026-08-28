//@ts-nocheck
import express from "express";
import mongoose from "mongoose";
import { Booking } from "../models/Booking.js";
import redis from "../redisClient.js"; // The Redis connection we wrote earlier
import { calculateSessionPrice } from "../services/pricingService.js";

const router = express.Router();

// POST /api/bookings/checkout
router.post("/checkout", async (req, res) => {
    // In a real app, userId comes from your JWT middleware
    const { userId, stationIds, startTime, endTime, socketId } = req.body;
    const timeSlot = `${startTime}-${endTime}`;

    // 1. Initialize the MongoDB Atomic Session
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // 2. Verify the Redis locks are still valid and belong to this user
        for (const stationId of stationIds) {
            const lockOwner = await redis.get(`lock:${stationId}:${timeSlot}`);
            
            if (!lockOwner) {
                throw new Error(`Payment took too long! The 120-second lock expired for station ${stationId}.`);
            }
            if (lockOwner !== socketId) {
                throw new Error(`Concurrency violation: Station ${stationId} is locked by another user.`);
            }
        }

        // 3. Generate the final deterministic price quote
        const quote = await calculateSessionPrice(stationIds, startTime, endTime);

        // 4. Create the permanent Booking Record 
        // Notice we pass { session } so Mongoose knows this is part of the transaction
        const newBooking = new Booking({
            user: userId,
            stationIds,
            startTime,
            endTime,
            totalAmount: quote.totalPrice,
            pricingBreakdown: quote.breakdown,
            status: "CONFIRMED"
        });

        await newBooking.save({ session });

        // 5. Commit the Transaction - This makes the booking permanent
        await session.commitTransaction();
        session.endSession();

        // 6. Clean up Redis Locks immediately (Don't wait for the TTL to hit zero)
        for (const stationId of stationIds) {
            await redis.del(`lock:${stationId}:${timeSlot}`);
        }

        // Return the final receipt to the React frontend
        return res.status(200).json({ 
            success: true, 
            message: "Seats permanently booked!",
            receipt: newBooking 
        });

    } catch (error) {
        // ROLLBACK: If anything fails above, abort the transaction instantly
        await session.abortTransaction();
        session.endSession();
        console.error("Checkout Transaction Failed:", error.message);
        
        return res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
});

export default router;