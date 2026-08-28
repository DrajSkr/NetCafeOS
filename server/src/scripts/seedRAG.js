//@ts-nocheck
import mongoose from "mongoose";
import dotenv from "dotenv";
import fs from "fs";
import { RuleChunk } from "../models/RuleChunk.js";

dotenv.config();

async function generateEmbeddings() {
    try {
        // 1. Connect to MongoDB
        await mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/netcafe_db");
        console.log("Connected to DB for local ingestion...");

        // 2. Read the raw text data correctly from the root folder
        const rawData = fs.readFileSync("../../../data/cafe_rules.json", "utf-8");
        const rules = JSON.parse(rawData);

        // Clear existing chunks to prevent duplicates
        await RuleChunk.deleteMany({}); 

        // 3. Loop through rules, hit local Ollama, and save to MongoDB
        for (const rule of rules) {
            console.log(`Generating local embedding for: ${rule.title}`);
            
            const response = await fetch("http://localhost:11434/api/embeddings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: "nomic-embed-text",
                    prompt: rule.content
                })
            });
            
            if (!response.ok) {
                throw new Error("Ollama failed. Is the server running?");
            }
            
            const data = await response.json();
            const vector = data.embedding;

            await RuleChunk.create({
                title: rule.title,
                category: rule.category,
                content: rule.content,
                embedding: vector
            });
        }
        console.log("Knowledge base successfully embedded locally!");
        process.exit(0);
    } catch (error) {
        console.error("Ingestion failed:", error);
        process.exit(1);
    }
}

generateEmbeddings();