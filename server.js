// ── ScholarAI Express Server (Zero Compilation) ──
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Simple JSON DB ──
const dbFile = path.join(__dirname, 'scholarai_data.json');
let db = { stats: {} };
if (fs.existsSync(dbFile)) {
    try {
        db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
        if (!db.stats) db.stats = {};
    } catch (e) { }
}
function saveDb() {
    try {
        fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
    } catch (e) {
        console.warn('Skipping file write on Vercel read-only filesystem');
    }
}

// ── Middleware ──
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// ── Static Files (serves public/ folder) ──
const publicPath = path.join(process.cwd(), 'public');
app.use(express.static(publicPath));
// Fallback to root for certain files if they were moved/missed
app.use(express.static(process.cwd()));

// ── API Routes ──

// Stats endpoints
app.post('/api/stats', (req, res) => {
    db.stats = req.body;
    saveDb();
    res.json({ ok: true });
});

app.get('/api/stats', (req, res) => {
    res.json(db.stats);
});

// Proxy route for Google Gemini
app.post('/api/ai/proxy', async (req, res) => {
    try {
        const { GoogleGenAI } = require('@google/genai');
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

        const { messages, system, maxTokens } = req.body;

        // Convert Claude message format to Gemini format
        let contents = [];
        let systemInstruction = undefined;

        if (system) {
            systemInstruction = system;
        }

        // Map roles and structure messages
        for (const msg of messages) {
            const role = msg.role === 'assistant' ? 'model' : 'user';
            contents.push({
                role: role,
                parts: [{ text: msg.content }]
            });
        }

        const config = {
            maxOutputTokens: maxTokens || 2048,
        };

        if (systemInstruction) {
            config.systemInstruction = systemInstruction;
        }

        const response = await ai.models.generateContent({
            model: 'gemini-1.5-flash',
            contents: contents,
            config: config
        });

        if (!response || !response.text) {
            throw new Error("Invalid response format from Gemini");
        }

        res.json({ reply: response.text });
    } catch (e) {
        console.error('API Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ── SPA Fallback ──
app.get('*', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

// ── Start Server ──
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`\n  ╔══════════════════════════════════════╗`);
        console.log(`  ║   🔬 ScholarAI Server Running        ║`);
        console.log(`  ║   http://localhost:${PORT}              ║`);
        console.log(`  ╚══════════════════════════════════════╝\n`);
    });
}
module.exports = app;
