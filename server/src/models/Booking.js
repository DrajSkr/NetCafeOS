import mongoose from "mongoose";

const bookingSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    items: [{
        seatId: { type: String, required: true },
        timeSlot: { type: String, required: true },
        date: { type: String, required: true },
        price: { type: Number }
    }],
    totalPrice: { type: Number, required: true },
    date: { type: Date, default: Date.now }, 
    status: { type: String, default: "PENDING" }
});

export const Booking = mongoose.model("Booking", bookingSchema);