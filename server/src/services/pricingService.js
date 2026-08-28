import { Booking } from "../models/Booking.js";
import { Station } from "../models/Station.js";

// Hardware Tier Multipliers (Base rates can be configured in MongoDB, e.g., ₹70/hr for Standard)
const TIER_MULTIPLIERS = {
    STANDARD: 1.0,
    PRO_ESPORTS: 1.6,     // e.g., ₹110/hr
    VIP_STREAMING: 2.2,   // e.g., ₹150/hr
    SIM_RACING: 3.0       // e.g., ₹200/hr
};

// Time-of-Day Multipliers (24-hour format)
function getTimeMultiplier(hour) {
    if (hour >= 8 && hour <= 12) return 0.8;  // 20% Off-peak morning discount
    if (hour >= 18 && hour <= 23) return 1.15; // 15% Peak evening surge
    return 1.0; // Standard rate
}

// Day-of-Week Multiplier (Weekend vs Weekday)
function getDayMultiplier(date) {
    const day = date.getDay(); // 0 is Sunday, 6 is Saturday
    const isWeekend = (day === 0 || day === 6);
    
    // Weekend surge: 20% extra charge due to high weekend footfall
    return isWeekend ? 1.1 : 1.0; 
}

// Group Volume Discount Multiplier for squads
function getGroupDiscountMultiplier(count) {
    if (count >= 5) return 0.80; // 20% off for a full 5-player squad
    if (count >= 3) return 0.90; // 10% off for a small group of 3-4 PCs
    if (count >= 2) return 0.95; // 5% off for pairs/couples
    return 1.0;                  // No discount for solo players
}

export async function calculateSessionPrice(stationIds, startTime, endTime) {
    // 1. Fetch the stations being booked
    const stations = await Station.find({ _id: { $in: stationIds } });
    if (stations.length !== stationIds.length) {
        throw new Error("One or more stations not found.");
    }
    // 2. Calculate duration in hours
    const start = new Date(startTime);
    const end = new Date(endTime);
    const durationHours = (end - start) / (1000 * 60 * 60);

    // 3. Check live occupancy across the café
    const totalStationsCount = await Station.countDocuments({ isOperational: true });
    
    const overlappingBookings = await Booking.find({
        status: { $in: ["CONFIRMED", "COMPLETED"] },
        $or: [
            { startTime: { $lt: end }, endTime: { $gt: start } }
        ]
    });

    const bookedStationIds = new Set();
    overlappingBookings.forEach(b => {
        b.stationIds.forEach(id => bookedStationIds.add(id.toString()));
    });
    
    const occupancyRate = totalStationsCount > 0 ? bookedStationIds.size / totalStationsCount : 0;
    
    // 4. Smooth Linear Surge Pricing Formula
    let demandMultiplier = 1.0;
    if (occupancyRate > 0.5) {
        const excessOccupancy = occupancyRate - 0.5; // Range: 0.0 to 0.5
        demandMultiplier += excessOccupancy * 0.6;   // Max addition is 0.3 (total 1.3x at 100% occupancy)
    }

    // 5. Gather temporal and group factors
    const startHour = start.getHours();
    const timeMultiplier = getTimeMultiplier(startHour);
    const dayMultiplier = getDayMultiplier(start); // Weekday vs Weekend check
    const groupDiscountMultiplier = getGroupDiscountMultiplier(stationIds.length);

    // 6. Calculate Final Price in INR
    let totalPrice = 0;

    stations.forEach(station => {
        const tierMult = TIER_MULTIPLIERS[station.tier] || 1.0;
        // Factor in base rate, tier, time of day, weekend/weekday status, and live occupancy surge
        const stationHourlyRate = (station.baseHourlyRate || 70) * tierMult * timeMultiplier * dayMultiplier * demandMultiplier;
        totalPrice += (stationHourlyRate * durationHours);
    });

    // Apply group volume discount
    totalPrice *= groupDiscountMultiplier;

    // Round to the nearest multiple of ₹5 for clean cash/UPI billing (using your updated round logic)
    const roundedPrice = Math.round(totalPrice);

    return {
        totalPrice: roundedPrice > 0 ? roundedPrice : 10, // Minimum floor price of ₹10
        currency: "INR",
        breakdown: {
            rawPrice: Math.round(totalPrice * 100) / 100,
            durationHours: Math.round(durationHours * 100) / 100,
            timeMultiplier,
            dayMultiplier, // Shows whether weekend rate was applied (1.1x vs 1.0x)
            demandMultiplier: Math.round(demandMultiplier * 100) / 100,
            groupDiscount: `${Math.round((1 - groupDiscountMultiplier) * 100)}% off`,
            occupancyRate: `${Math.round(occupancyRate * 100)}%`
        }
    };
}