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

// Proxy route for Groq API
app.post('/api/ai/proxy', async (req, res) => {
    try {
        const fetch = require('node-fetch');
        const apiKey = process.env.GROQ_API_KEY;
        const { messages, system, maxTokens } = req.body;

        const apiMessages = [];

        if (system) {
            apiMessages.push({ role: 'system', content: system });
        }

        for (const msg of messages) {
            apiMessages.push({
                role: msg.role === 'model' ? 'assistant' : msg.role,
                content: msg.content
            });
        }

        const body = {
            model: 'llama-3.3-70b-versatile',
            messages: apiMessages,
            max_tokens: maxTokens || 2048,
            temperature: 0.7
        };

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(body)
        });

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error.message || "API Error");
        }

        const text = data.choices?.[0]?.message?.content;

        if (!text) {
            throw new Error("Empty response from Groq");
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
