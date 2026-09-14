//@ts-nocheck
import 'dotenv/config';
import { pool, initPostgres } from '../db/postgres.js';
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function generateEmbeddings() {
    try {
        // 1. Connect to PostgreSQL and initialize
        await initPostgres();
        console.log("Connected to PostgreSQL for local ingestion...");

        // 2. Read the raw text data correctly from the root folder
        // Resolve path relative to this script file's location
        const dataPath = path.resolve(__dirname, "../../../data/cafe_rules.json");
        const rawData = fs.readFileSync(dataPath, "utf-8");
        const rules = JSON.parse(rawData);

        // Clear existing chunks to prevent duplicates
        await pool.query('TRUNCATE TABLE rule_chunks RESTART IDENTITY'); 

        // 3. Loop through rules, hit local Ollama, and save to Postgres
        console.log(`\n📚 Embedding ${rules.length} knowledge chunks...\n`);
        for (const [i, rule] of rules.entries()) {
            process.stdout.write(`[${i + 1}/${rules.length}] Embedding: "${rule.title}"... `);
            
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

            // pgvector supports inserting arrays in parameter bindings
            await pool.query(
                'INSERT INTO rule_chunks (title, category, content, embedding) VALUES ($1, $2, $3, $4)',
                [rule.title, rule.category, rule.content, JSON.stringify(vector)]
            );
            
            console.log(`✅ done (dim: ${vector.length})`);
        }
        console.log(`\n🎉 Knowledge base fully embedded! ${rules.length} chunks ready.`);
        process.exit(0);
    } catch (error) {
        console.error("Ingestion failed:", error);
        process.exit(1);
    }
}

generateEmbeddings();