// ── AI Routes (Groq API Proxy + Data Persistence) ──
const express = require('express');
const fetch = require('node-fetch');
const { authMiddleware } = require('./auth');
const { getDb, incrementStat, getStats } = require('../db');

const router = express.Router();
const GROQ_KEY = process.env.GROQ_API_KEY;

// ── All AI routes require authentication ──
router.use(authMiddleware);

// ── Helper: call Groq API (OpenAI-compatible) ──
async function callGroq(messages, system = '', maxTokens = 1500) {
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
            'Authorization': `Bearer ${GROQ_KEY}`
        },
        body: JSON.stringify(body)
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error("Empty response from Groq");
    return text;
}

const callClaude = callGroq;

// ═══════════════════════════════════════════
//  POST /api/ai/chat — Research AI Chat
// ═══════════════════════════════════════════
const CHAT_SYS = `You are ScholarAI, an expert AI research assistant specializing in academic writing, scientific methodology, statistics, and journal publishing. Help researchers write, format, and publish papers. Be specific, practical and use **bold** for key terms. Keep responses focused and useful.`;

router.post('/chat', async (req, res) => {
    try {
        const { messages } = req.body;
        if (!messages || !messages.length) {
            return res.status(400).json({ error: 'Messages are required' });
        }

        const reply = await callClaude(messages, CHAT_SYS, 1200);

        // Save to chat history
        const db = getDb();
        const lastUserMsg = messages.filter(m => m.role === 'user').pop();
        if (lastUserMsg) {
            db.prepare('INSERT INTO chat_history (user_id, role, content) VALUES (?, ?, ?)').run(
                req.userId, 'user', lastUserMsg.content
            );
        }
        db.prepare('INSERT INTO chat_history (user_id, role, content) VALUES (?, ?, ?)').run(
            req.userId, 'assistant', reply
        );

        incrementStat(req.userId, 'chats_count');
        res.json({ reply });
    } catch (e) {
        console.error('Chat error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ═══════════════════════════════════════════
//  POST /api/ai/format — Article Formatter
// ═══════════════════════════════════════════
router.post('/format', async (req, res) => {
    try {
        const { input, citation, type, wordlimit, journal, heading, abstract } = req.body;
        if (!input) return res.status(400).json({ error: 'Input text is required' });

        const prompt = `You are an expert academic manuscript formatter.

The user has provided text which may be: (1) a manuscript to format, (2) journal author guidelines, or (3) both.

Formatting requirements:
- Citation style: ${citation || 'APA 7th Edition'}
- Article type: ${type || 'Original Research'}
- Word limit: ${wordlimit || 'No limit'}
- Target journal: ${journal || 'not specified'}
- Heading style: ${heading || 'IMRAD'}
- Abstract format: ${abstract || 'Structured'}

User input:
"""
${input.substring(0, 3500)}
"""

Instructions:
- If guidelines were pasted, extract all rules and apply them to restructure any article content present
- Reformat all citations to the specified style
- Add proper section headings in the correct order
- Structure the abstract correctly
- At the end, add a section "⚠ FORMATTING NOTES:" listing any issues found (word count, missing sections, etc.)

Output the complete formatted manuscript.`;

        const result = await callClaude([{ role: 'user', content: prompt }], '', 2000);

        // Save to database
        const db = getDb();
        db.prepare('INSERT INTO formatted_articles (user_id, input_text, output_text, settings_json) VALUES (?, ?, ?, ?)').run(
            req.userId, input.substring(0, 5000), result, JSON.stringify({ citation, type, wordlimit, journal, heading, abstract })
        );

        incrementStat(req.userId, 'formatted_count');
        res.json({ result });
    } catch (e) {
        console.error('Format error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ═══════════════════════════════════════════
//  POST /api/ai/citations — Citation Verifier
// ═══════════════════════════════════════════
router.post('/citations', async (req, res) => {
    try {
        const { input, style } = req.body;
        if (!input) return res.status(400).json({ error: 'Citation text is required' });

        const prompt = `You are an expert academic citation verifier. Analyze the following reference list using ${style || 'APA 7th Edition'} standards.

References to verify:
"""
${input}
"""

For EACH reference, provide a JSON array where each object has:
- "num": number (1, 2, 3...)
- "text": the original citation text (verbatim)
- "status": one of "valid", "warning", or "invalid"
- "note": specific, actionable feedback about what is correct or what needs to be fixed

Check every reference for:
- Correct ${style || 'APA 7th Edition'} formatting
- All required fields present (authors, year, title, journal/publisher, volume, issue, pages, DOI)
- Proper capitalization and punctuation
- "et al." usage rules
- DOI format validity

Be specific in your notes. Respond ONLY with a valid JSON array. No other text.`;

        const result = await callClaude([{ role: 'user', content: prompt }], '', 2500);

        // Save to database
        const db = getDb();
        db.prepare('INSERT INTO citations (user_id, input_text, results_json, style) VALUES (?, ?, ?, ?)').run(
            req.userId, input.substring(0, 5000), result, style || 'APA 7th Edition'
        );

        incrementStat(req.userId, 'citations_count');
        res.json({ result });
    } catch (e) {
        console.error('Citations error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ═══════════════════════════════════════════
//  POST /api/ai/journals — Journal Finder
// ═══════════════════════════════════════════
router.post('/journals', async (req, res) => {
    try {
        const { topic, ifFilter, oaFilter } = req.body;
        if (!topic) return res.status(400).json({ error: 'Topic is required' });

        const prompt = `You are an expert in academic publishing. Recommend journals for this research.

Research topic: "${topic}"
Impact factor preference: ${ifFilter ? 'minimum IF ' + ifFilter : 'any'}
Access preference: ${oaFilter || 'any'}

Recommend exactly 6 journals as a JSON array. Each journal must have:
- "abbr": abbreviation (max 8 chars, uppercase)
- "name": full journal name
- "publisher": publisher name
- "if": impact factor as string like "3.7" or "58.7"
- "scope": 1-sentence description of what the journal covers
- "citation": citation style (e.g. "APA", "Vancouver", "IEEE")
- "wordlimit": word limit (e.g. "4,000 words" or "No limit")
- "review_time": average review time (e.g. "~28 days")
- "indexing": main databases (e.g. "PubMed, Scopus, WoS")
- "guideline": 2-3 sentences of key submission requirements
- "fit": exactly why this journal fits the given research topic (1 sentence)

Make recommendations that genuinely match the research topic. Mix high-impact and accessible options.
Respond ONLY with valid JSON array.`;

        const result = await callClaude([{ role: 'user', content: prompt }], '', 2000);
        res.json({ result });
    } catch (e) {
        console.error('Journals error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ═══════════════════════════════════════════
//  POST /api/ai/litreview — Literature Review
// ═══════════════════════════════════════════
router.post('/litreview', async (req, res) => {
    try {
        const { sources } = req.body;
        if (!sources || !sources.length) return res.status(400).json({ error: 'Sources are required' });

        const sourceList = sources.map((s, i) => `[${i + 1}] ${s}`).join('\n');
        const prompt = `You are an expert academic writer. Generate a comprehensive literature review based on these sources:

${sourceList}

Write a formal academic literature review (600-900 words) that:
1. Opens with a paragraph framing the research area and why it matters
2. Has 2-3 thematic sections with clear subheadings (##)
3. Synthesizes and compares across sources — don't just summarize one by one
4. Uses proper in-text citations like (Author et al., Year) throughout
5. Notes contradictions or debates in the literature
6. Identifies research gaps
7. Concludes with a paragraph on the current state of knowledge

Write in formal academic style. Full paragraphs only. Make it sound human and scholarly.`;

        const result = await callClaude([{ role: 'user', content: prompt }], '', 2000);

        // Save to database
        const db = getDb();
        db.prepare('INSERT INTO literature_reviews (user_id, sources_json, output_text) VALUES (?, ?, ?)').run(
            req.userId, JSON.stringify(sources), result
        );

        incrementStat(req.userId, 'reviews_count');
        res.json({ result });
    } catch (e) {
        console.error('Litreview error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ═══════════════════════════════════════════
//  POST /api/ai/thesis — Thesis Converter
// ═══════════════════════════════════════════
router.post('/thesis', async (req, res) => {
    try {
        const { input, conversionType, journal, citationStyle } = req.body;
        if (!input) return res.status(400).json({ error: 'Thesis text is required' });

        const prompt = `You are an expert academic editor specializing in converting theses to journal articles.

Conversion type: ${conversionType || 'Full Chapter → Article'}
Target journal: ${journal || 'general academic journal'}
Citation style: ${citationStyle || 'APA 7th Edition'}

Thesis content:
"""
${input.substring(0, 4000)}
"""

Convert this into a publication-ready journal article. Include:

**TITLE**
[Concise, journal-style title]

**ABSTRACT** (max 250 words)
Background: ...
Objectives: ...
Methods: ...
Results: ...
Conclusion: ...

**KEYWORDS**
[5-7 keywords]

**1. INTRODUCTION** (~500-600 words)
[Background, research gap, study objectives — remove thesis preamble]

**2. METHODS**
[Concise third-person past tense]

**3. RESULTS**
[Key findings only]

**4. DISCUSSION**
[Interpretation, comparison with literature, limitations]

**5. CONCLUSION**
[1-2 paragraphs]

**EDITOR'S NOTES**
[3-5 specific changes made]`;

        const result = await callClaude([{ role: 'user', content: prompt }], '', 3000);

        // Save to database
        const db = getDb();
        db.prepare('INSERT INTO thesis_conversions (user_id, input_text, output_text, conversion_type, target_journal) VALUES (?, ?, ?, ?, ?)').run(
            req.userId, input.substring(0, 5000), result, conversionType || 'Full Chapter → Article', journal || ''
        );

        res.json({ result });
    } catch (e) {
        console.error('Thesis error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ═══════════════════════════════════════════
//  GET /api/ai/stats — User Stats
// ═══════════════════════════════════════════
router.get('/stats', (req, res) => {
    try {
        const stats = getStats(req.userId);
        res.json({ stats });
    } catch (e) {
        console.error('Stats error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ═══════════════════════════════════════════
//  GET /api/ai/history/chat — Chat History
// ═══════════════════════════════════════════
router.get('/history/chat', (req, res) => {
    try {
        const db = getDb();
        const rows = db.prepare(
            'SELECT role, content, created_at FROM chat_history WHERE user_id = ? ORDER BY id DESC LIMIT 50'
        ).all(req.userId);
        res.json({ history: rows.reverse() });
    } catch (e) {
        console.error('Chat history error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ═══════════════════════════════════════════
//  GET /api/ai/history/articles — Saved Articles
// ═══════════════════════════════════════════
router.get('/history/articles', (req, res) => {
    try {
        const db = getDb();
        const rows = db.prepare(
            'SELECT id, settings_json, created_at FROM formatted_articles WHERE user_id = ? ORDER BY id DESC LIMIT 20'
        ).all(req.userId);
        res.json({ articles: rows });
    } catch (e) {
        console.error('Articles history error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ═══════════════════════════════════════════
//  DELETE /api/ai/history/chat — Clear Chat
// ═══════════════════════════════════════════
router.delete('/history/chat', (req, res) => {
    try {
        const db = getDb();
        db.prepare('DELETE FROM chat_history WHERE user_id = ?').run(req.userId);
        res.json({ success: true });
    } catch (e) {
        console.error('Clear chat error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
