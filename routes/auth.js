// ── Auth Routes ──
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDb, ensureStats } = require('../db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'scholarai_fallback_secret';

// ── Middleware: authenticate JWT ──
function authMiddleware(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }
    try {
        const token = header.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userId = decoded.userId;
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

// ── POST /api/auth/register ──
router.post('/register', async (req, res) => {
    try {
        const { email, password, name } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }
        const db = getDb();
        const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
        if (existing) {
            return res.status(409).json({ error: 'Email already registered' });
        }
        const id = uuidv4();
        const password_hash = await bcrypt.hash(password, 10);
        db.prepare('INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)').run(
            id, email, password_hash, name || 'Researcher'
        );
        ensureStats(id);
        const token = jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '7d' });
        res.json({
            token,
            user: { id, email, name: name || 'Researcher', plan: 'free' }
        });
    } catch (e) {
        console.error('Register error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// ── POST /api/auth/login ──
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        const db = getDb();
        const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        ensureStats(user.id);
        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
        res.json({
            token,
            user: { id: user.id, email: user.email, name: user.name, plan: user.plan }
        });
    } catch (e) {
        console.error('Login error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// ── GET /api/auth/me ──
router.get('/me', authMiddleware, (req, res) => {
    try {
        const db = getDb();
        const user = db.prepare('SELECT id, email, name, plan, created_at FROM users WHERE id = ?').get(req.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ user });
    } catch (e) {
        console.error('Me error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
module.exports.authMiddleware = authMiddleware;
