import express from "express";
import { pool } from "../db/postgres.js";

const router = express.Router();

// ─── Rotating fallback replies ──────────────────────────────────────────────
// When no chunk scores high enough, rotate through these so the bot
// doesn't sound like a broken record. Each variant mentions contact info
// or gives the user a human path forward.
const FALLBACK_REPLIES = [
    "Hmm, I'm not quite sure about that one! 🤔 For anything outside my knowledge, you can reach a real human at **+9123085033** or email **support@netcafeos.in** — Dhiraj will sort you out.",
    "That's a bit outside my knowledge base right now. Try contacting our support team directly: 📞 **+9123085033** or 📧 **support@netcafeos.in**. They're available during café hours (8 AM – 8 PM).",
    "I don't have a confident answer for that! Don't want to guess and mislead you. Give the front desk a call at **+9123085033** or drop an email to **support@netcafeos.in** and we'll get back to you ASAP.",
    "Not in my knowledge base yet! 😅 Feel free to reach out to our support at **+9123085033** — or walk up to the front desk if you're in the café. Real humans are faster for the tricky stuff.",
    "That one's got me stumped! Try emailing **support@netcafeos.in** or calling **+9123085033**. Our manager Dhiraj will personally look into it for you.",
    "Oops, I don't have enough info to answer that reliably. Rather than guessing, I'd say hit up the team at **+9123085033** — they're the real experts here! 🎮"
];

let fallbackIndex = 0;
const getNextFallback = () => {
    const reply = FALLBACK_REPLIES[fallbackIndex % FALLBACK_REPLIES.length];
    fallbackIndex++;
    return reply;
};

// ─── POST /api/chat/ask ─────────────────────────────────────────────────────
router.post("/ask", async (req, res) => {
    try {
        const { message, history = [] } = req.body;
        if (!message || !message.trim()) {
            return res.status(400).json({ error: "Message is required" });
        }

        // 1. Build a contextual query for the embedding search
        // Take the last 2 user messages from history + the current message
        const recentUserMsgs = history
            .filter(msg => msg.role === "user")
            .slice(-2)
            .map(msg => msg.content);

        const searchPrompt = [...recentUserMsgs, message].join(" ");

        // Embed the contextual search prompt instead of just the isolated message
        const embedRes = await fetch("http://localhost:11434/api/embeddings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: "nomic-embed-text", prompt: searchPrompt })
        });

        if (!embedRes.ok) {
            throw new Error("Ollama embedding service is offline.");
        }

        const embedData = await embedRes.json();
        const queryVector = embedData.embedding;

        // 2. Search Postgres using pgvector's HNSW index
        // The <=> operator computes cosine distance, so 1 - distance = cosine similarity
        const { rows } = await pool.query(`
            SELECT title, content, 1 - (embedding <=> $1) AS score
            FROM rule_chunks
            ORDER BY embedding <=> $1
            LIMIT 2;
        `, [JSON.stringify(queryVector)]);

        const best = rows[0];
        const second = rows[1];

        // 4. Determine context to use
        let context = "No relevant knowledge base rules found for this specific query.";
        let useSecond = false;

        if (best && best.score >= 0.45) {
            useSecond = second && second.score >= 0.42 && second.title !== best.title;
            context = useSecond
                ? `${best.content}\n\nAdditional context: ${second.content}`
                : best.content;
        }

        // 6. Build the LLM prompt
        const systemInstruction = `You are Buddy, the friendly AI support assistant for NetCafeOS — a premium online gaming cafe.
Your personality: helpful, chill, concise, and a little fun. You understand gen-z slang and casual language.

STRICT RULES:
- Answer ONLY using the context provided below. Do not make up any facts, numbers, or prices.
- If asked something you cannot answer using the context, you MUST reply with exactly the word: [FALLBACK]
- Do not use [FALLBACK] for casual chat (e.g. "ok", "hi").
- Keep responses concise (2–4 sentences).`;

        const messages = [
            { role: "system", content: systemInstruction },
            ...history.slice(-5), // reduced history length to prevent context drift
            {
                role: "user",
                content: `Context information:\n---\n${context}\n---\n\nUser Question: ${message}\n\nAnswer the question strictly using the provided context.`
            }
        ];

        // 7. Send to local Llama 3.2 for chat generation
        const chatRes = await fetch("http://localhost:11434/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "llama3.2",
                messages,
                stream: false,
                options: {
                    temperature: 0.3,   // Slightly low temperature to prevent hallucination
                    top_p: 0.9,
                    num_predict: 200    // Cap response length
                }
            })
        });

        if (!chatRes.ok) {
            throw new Error("Llama chat service is offline.");
        }

        const chatData = await chatRes.json();
        let reply = chatData.message?.content?.trim();

        if (!reply || reply.includes("[FALLBACK]")) {
            reply = getNextFallback();
        }

        return res.json({
            reply,
            _debug: { topMatch: best?.title, score: best?.score?.toFixed(3), usedSecond: useSecond }
        });

    } catch (error) {
        console.error("Chat error:", error.message);
        return res.status(500).json({
            error: "AI service offline.",
            reply: "Buddy is taking a quick nap 😴 — please try again in a moment or contact us at **+9123085033**."
        });
    }
});

export default router;