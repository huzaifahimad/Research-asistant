// ── ScholarAI Express Server (Vercel Native) ──
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();

// ── Simple In-Memory DB (Vercel is stateless) ──
let db = { stats: {} };

// ── Middleware ──
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// ── Static Files (handled by Vercel static engine for root, but this is fallback) ──
app.use(express.static(path.join(__dirname, '../public')));

// ── API Routes ──

// Stats endpoints
app.post('/api/stats', (req, res) => {
    db.stats = req.body;
    res.json({ ok: true });
});

app.get('/api/stats', (req, res) => {
    res.json(db.stats);
});

// Proxy route for Google Gemini
app.post('/api/ai/proxy', async (req, res) => {
    try {
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

        const { messages, system, maxTokens } = req.body;

        let contents = [];
        let systemInstruction = system || undefined;

        for (const msg of messages) {
            const role = msg.role === 'assistant' ? 'model' : 'user';
            contents.push({
                role: role,
                parts: [{ text: msg.content }]
            });
        }

        const generationConfig = {
            maxOutputTokens: maxTokens || 2048,
        };

        const result = await model.generateContent({
            contents,
            systemInstruction,
            generationConfig
        });

        const response = await result.response;
        const text = response.text();

        if (!text) {
            throw new Error("Empty response from Gemini");
        }

        res.json({ reply: text });
    } catch (e) {
        console.error('API Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ── SPA Fallback ──
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

module.exports = app;
