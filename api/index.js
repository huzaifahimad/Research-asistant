// ── ScholarAI Express Server (Vercel Native) ──
require('dotenv').config();
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
        const fetch = require('node-fetch');
        const apiKey = process.env.GEMINI_API_KEY;
        const { messages, system, maxTokens } = req.body;

        let contents = [];
        for (const msg of messages) {
            const role = msg.role === 'assistant' ? 'model' : 'user';
            contents.push({
                role: role,
                parts: [{ text: msg.content }]
            });
        }

        const body = {
            contents,
            generationConfig: {
                maxOutputTokens: maxTokens || 2048,
            }
        };

        if (system) {
            body.systemInstruction = {
                parts: [{ text: system }]
            };
        }

        const uri = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

        const response = await fetch(uri, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error.message || "API Error");
        }

        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

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

// ── Local Development Server ──
if (require.main === module) {
    const port = process.env.PORT || 4000;
    app.listen(port, () => {
        console.log(`ScholarAI Express Server running at http://localhost:${port}`);
    });
}
