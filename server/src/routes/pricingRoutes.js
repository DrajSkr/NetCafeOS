import express from "express";
import { Tier } from "../models/Tier.js";

const router = express.Router();

// GET /api/pricing
router.get("/", async (req, res) => {
    try {
        let tiers = await Tier.find();

        // Auto-seed the database if it's empty so you don't have to do it manually
        if (tiers.length === 0) {
            console.log("No pricing tiers found. Auto-seeding defaults...");
            const defaultTiers = [
                { name: "ECONOMY", price: 50, description: "Budget rigs" },
                { name: "STANDARD", price: 80, description: "Mid-tier performance" },
                { name: "PRO", price: 120, description: "High-refresh setups" },
                { name: "LUXURY", price: 200, description: "Premium lounge pods" }
            ];
            await Tier.insertMany(defaultTiers);
            tiers = await Tier.find();
        }

        // Convert array to a clean lookup object: { "ECONOMY": 50, "STANDARD": 80, ... }
        const pricingMap = tiers.reduce((acc, tier) => {
            acc[tier.name] = tier.price;
            return acc;
        }, {});

        res.json({ success: true, pricing: pricingMap });
    } catch (error) {
        console.error("Pricing fetch error:", error);
        res.status(500).json({ error: "Failed to fetch pricing" });
    }
});

export default router;