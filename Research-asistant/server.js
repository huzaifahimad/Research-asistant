// ── ScholarAI Express Server ──
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { getDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// ── Static Files (serves public/ folder) ──
app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes ──
app.use('/api/auth', require('./routes/auth'));
app.use('/api/ai', require('./routes/ai'));

// ── SPA Fallback ──
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start Server ──
app.listen(PORT, () => {
    // Initialize database on startup
    getDb();
    console.log(`\n  ╔══════════════════════════════════════╗`);
    console.log(`  ║   🔬 ScholarAI Server Running        ║`);
    console.log(`  ║   http://localhost:${PORT}              ║`);
    console.log(`  ╚══════════════════════════════════════╝\n`);
});
