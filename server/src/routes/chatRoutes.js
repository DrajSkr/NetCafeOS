import express from "express";
import { RuleChunk } from "../models/RuleChunk.js";

const router = express.Router();

// The core math to compare two vectors (angles between them)
function cosineSimilarity(vecA, vecB) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

router.post("/ask", async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) return res.status(400).json({ error: "Message is required" });

        // 1. Convert the user's question into a vector using local Ollama
        const embedRes = await fetch("http://localhost:11434/api/embeddings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "nomic-embed-text",
                prompt: message
            })
        });
        const embedData = await embedRes.json();
        const queryVector = embedData.embedding;

        // 2. Fetch all rule chunks from MongoDB
        const allChunks = await RuleChunk.find({});

        // 3. Score each chunk against the user's question using Cosine Similarity
        const scoredChunks = allChunks.map(chunk => ({
            content: chunk.content,
            score: cosineSimilarity(queryVector, chunk.embedding)
        }));

        // Sort by highest score (closest mathematical match)
        scoredChunks.sort((a, b) => b.score - a.score);

        // Pick the top most relevant chunk (or top 2 if you have a lot of data)
        const bestMatch = scoredChunks[0];

        // If the score is too low, the bot shouldn't guess.
        if (bestMatch.score < 0.5) {
            return res.json({ reply: "I'm not sure about that. Please ask the front desk." });
        }

        // 4. Construct the prompt for the LLM
        const promptContext = `
        You are the NetCafe OS Support AI. Answer the user's question using ONLY the context provided below. 
        If the context mentions a fine or penalty for the action, YOU MUST explicitly state the fine in your response. Do not hallucinate outside rules.
        
        Context: ${bestMatch.content}
        
        User Question: ${message}
        `;

        // 5. Send to local Llama 3.2 to generate a human-readable response
        const chatRes = await fetch("http://localhost:11434/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "llama3.2",
                prompt: promptContext,
                stream: false // Keep it false for simple REST response
            })
        });

        const chatData = await chatRes.json();

        return res.json({ 
            reply: chatData.response,
            _debug_context_used: bestMatch.content // Good for debugging what the bot actually read
        });

    } catch (error) {
        console.error("Chat error:", error);
        return res.status(500).json({ error: "AI service offline." });
    }
});

export default router;