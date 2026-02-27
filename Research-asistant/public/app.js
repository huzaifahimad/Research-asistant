// ── ScholarAI Frontend — Uses PowerShell backend proxy ──
// API calls go through /api/ai/proxy, stats saved in localStorage

const S = {
    chatHistory: [],
    sources: [],
    user: JSON.parse(localStorage.getItem('scholarai_user') || 'null'),
    stats: JSON.parse(localStorage.getItem('scholarai_stats') || '{"formatted":0,"citations":0,"chats":0,"reviews":0}')
};

// ═══ API — calls through local PowerShell proxy ═══
async function callClaude(messages, system = '', maxTokens = 1500) {
    const r = await fetch('/api/ai/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, system, maxTokens })
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    return d.reply;
}

// ═══ AUTH / SETTINGS ═══
function switchAuthTab(tab) {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.auth-tab:${tab === 'login' ? 'first' : 'last'}-child`).classList.add('active');
    document.getElementById('auth-form-login').style.display = tab === 'login' ? 'flex' : 'none';
    document.getElementById('auth-form-register').style.display = tab === 'register' ? 'flex' : 'none';
}

function handleLogin(e) {
    e.preventDefault();
    const name = document.getElementById('login-email').value.trim();
    if (!name) { document.getElementById('login-error').textContent = 'Enter your name'; return; }
    S.user = { name, plan: 'Pro' };
    localStorage.setItem('scholarai_user', JSON.stringify(S.user));
    onAuthSuccess();
}

function handleRegister(e) {
    e.preventDefault();
    const name = document.getElementById('reg-name').value.trim();
    if (!name) { document.getElementById('reg-error').textContent = 'Enter your name'; return; }
    S.user = { name, plan: 'Pro' };
    localStorage.setItem('scholarai_user', JSON.stringify(S.user));
    onAuthSuccess();
}

function onAuthSuccess() {
    document.getElementById('auth-overlay').classList.add('hidden');
    updateUserUI();
    updateStatsUI();
}

function handleLogout() {
    if (!confirm('Logout from ScholarAI?')) return;
    S.user = null;
    localStorage.removeItem('scholarai_user');
    document.getElementById('auth-overlay').classList.remove('hidden');
}

function updateUserUI() {
    if (!S.user) return;
    const initials = S.user.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
    document.getElementById('user-avatar').textContent = initials;
    document.getElementById('user-name-display').textContent = S.user.name;
}

function saveStats() {
    localStorage.setItem('scholarai_stats', JSON.stringify(S.stats));
    updateStatsUI();
}

function updateStatsUI() {
    document.getElementById('stat-formatted').textContent = S.stats.formatted;
    document.getElementById('stat-citations').textContent = S.stats.citations;
    document.getElementById('stat-chats').textContent = S.stats.chats;
    document.getElementById('stat-reviews').textContent = S.stats.reviews;
}

// ═══ INIT ═══
function init() {
    if (S.user) { onAuthSuccess(); }
    updateStatsUI();
}

// ═══ NAV ═══
function showPanel(id) {
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById('panel-' + id).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(item => {
        if (item.getAttribute('onclick')?.includes("'" + id + "'")) item.classList.add('active');
    });
}

// ═══ CHAT ═══
const CHAT_SYS = `You are ScholarAI, an expert AI research assistant specializing in academic writing, scientific methodology, statistics, and journal publishing. Help researchers write, format, and publish papers. Be specific, practical and use **bold** for key terms. Keep responses focused and useful.`;

async function sendChat() {
    const inp = document.getElementById('chat-input');
    const text = inp.value.trim();
    if (!text) return;
    inp.value = ''; inp.style.height = 'auto';
    addMsg('user', text);
    S.chatHistory.push({ role: 'user', content: text });
    document.getElementById('chat-send-btn').disabled = true;
    const typing = addTyping();
    try {
        const reply = await callClaude(S.chatHistory, CHAT_SYS, 1200);
        typing.remove();
        S.chatHistory.push({ role: 'assistant', content: reply });
        addMsg('ai', mdToHtml(reply));
        S.stats.chats++; saveStats();
    } catch (e) {
        typing.remove();
        addMsg('ai', '⚠ ' + (e.message || 'Connection error'));
    }
    document.getElementById('chat-send-btn').disabled = false;
}

function mdToHtml(t) { return t.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>').replace(/\n/g, '<br>'); }

function addMsg(role, html) {
    const el = document.createElement('div');
    el.className = 'msg' + (role === 'user' ? ' user' : '');
    el.innerHTML = `<div class="msg-avatar ${role === 'ai' ? 'ai' : 'user'}">${role === 'ai' ? 'AI' : 'U'}</div><div class="msg-bubble">${html}</div>`;
    const msgs = document.getElementById('chat-messages');
    msgs.appendChild(el); msgs.scrollTop = msgs.scrollHeight;
    return el;
}

function addTyping() {
    const el = document.createElement('div'); el.className = 'msg';
    el.innerHTML = `<div class="msg-avatar ai">AI</div><div class="msg-bubble"><div class="typing"><span></span><span></span><span></span></div></div>`;
    const msgs = document.getElementById('chat-messages');
    msgs.appendChild(el); msgs.scrollTop = msgs.scrollHeight;
    return el;
}

function handleChatKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px';
}
function sendChip(el) { document.getElementById('chat-input').value = el.textContent; sendChat(); }
function clearChat() {
    S.chatHistory = [];
    document.getElementById('chat-messages').innerHTML = `<div class="msg"><div class="msg-avatar ai">AI</div><div class="msg-bubble">Chat cleared! What can I help you with?</div></div>`;
}

// ═══ FORMATTER ═══
document.getElementById('format-input').addEventListener('input', function () {
    document.getElementById('fmt-wc').textContent = this.value.trim().split(/\s+/).filter(w => w).length + ' words';
});

async function runFormatter() {
    const input = document.getElementById('format-input').value.trim();
    if (!input) { showToast('⚠ Paste your article first'); return; }
    document.getElementById('fmt-loading').style.display = 'block';
    document.getElementById('fmt-btn').disabled = true;
    document.getElementById('fmt-status').textContent = 'Formatting...';
    document.getElementById('fmt-status').style.color = 'var(--warn)';
    document.getElementById('format-output').value = '';
    const prompt = `You are an expert academic manuscript formatter.\nFormatting: Citation=${document.getElementById('fmt-citation').value}, Type=${document.getElementById('fmt-type').value}, WordLimit=${document.getElementById('fmt-wordlimit').value}, Journal=${document.getElementById('fmt-journal').value || 'not specified'}, Heading=${document.getElementById('fmt-heading').value}, Abstract=${document.getElementById('fmt-abstract').value}\n\nInput:\n"""\n${input.substring(0, 3500)}\n"""\n\nReformat to spec. Add "⚠ FORMATTING NOTES:" at end. Output the full formatted manuscript.`;
    try {
        const result = await callClaude([{ role: 'user', content: prompt }], '', 2000);
        document.getElementById('format-output').removeAttribute('readonly');
        document.getElementById('format-output').value = result;
        document.getElementById('fmt-status').textContent = '✓ Formatted';
        document.getElementById('fmt-status').style.color = 'var(--success)';
        S.stats.formatted++; saveStats();
        showToast('✓ Article formatted!');
    } catch (e) {
        document.getElementById('fmt-status').textContent = 'Error';
        document.getElementById('fmt-status').style.color = 'var(--danger)';
        showToast('⚠ ' + e.message);
    }
    document.getElementById('fmt-loading').style.display = 'none';
    document.getElementById('fmt-btn').disabled = false;
}

// ═══ CITATION VERIFIER ═══
async function verifyCitations() {
    const input = document.getElementById('citation-input').value.trim();
    if (!input) { showToast('⚠ Paste references first'); return; }
    const style = document.getElementById('cite-style').value;
    document.getElementById('cite-loading').style.display = 'flex';
    document.getElementById('cite-btn').disabled = true;
    document.getElementById('citation-results').innerHTML = '<div style="text-align:center;padding:20px;color:var(--text3);">Analyzing...</div>';
    const prompt = `Verify these references using ${style}. For EACH, return JSON array: [{num, text, status("valid"|"warning"|"invalid"), note}]. Check formatting, fields, capitalization, DOI. ONLY valid JSON array.\n\n${input}`;
    try {
        const result = await callClaude([{ role: 'user', content: prompt }], '', 2500);
        const clean = result.replace(/```json|```/g, '').trim();
        const citations = JSON.parse(clean);
        const el = document.getElementById('citation-results'); el.innerHTML = '';
        citations.forEach(c => {
            const sc = c.status === 'valid' ? 'cs-valid' : c.status === 'warning' ? 'cs-warn' : 'cs-invalid';
            const si = c.status === 'valid' ? '✓ Verified' : c.status === 'warning' ? '⚠ Minor Issue' : '✗ Invalid';
            const nc = c.status === 'valid' ? 'var(--text3)' : c.status === 'warning' ? 'var(--gold)' : 'var(--danger)';
            el.innerHTML += `<div class="citation-item"><div class="citation-header"><span style="font-size:0.8rem;font-weight:600;">[${c.num}]</span><span class="citation-status ${sc}">${si}</span></div><div class="citation-text">${c.text}</div><div class="citation-note" style="color:${nc};">${c.note}</div></div>`;
        });
        S.stats.citations += citations.length; saveStats();
        showToast('✓ ' + citations.length + ' citations analyzed');
    } catch (e) {
        document.getElementById('citation-results').innerHTML = '<div style="padding:20px;color:var(--danger);">⚠ Parse error. Try again.</div>';
    }
    document.getElementById('cite-loading').style.display = 'none';
    document.getElementById('cite-btn').disabled = false;
}

// ═══ JOURNAL FINDER ═══
async function findJournals() {
    const topic = document.getElementById('journal-topic').value.trim();
    if (!topic) { showToast('⚠ Enter a topic'); return; }
    document.getElementById('journal-loading').style.display = 'block';
    document.getElementById('journal-btn').disabled = true;
    document.getElementById('journal-grid').innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--text3);">Finding journals...</div>';
    const prompt = `Recommend 6 journals for "${topic}" (IF pref: ${document.getElementById('journal-if').value || 'any'}, access: ${document.getElementById('journal-oa').value || 'any'}). JSON array: [{abbr, name, publisher, if, scope, citation, wordlimit, review_time, indexing, guideline, fit}]. ONLY valid JSON.`;
    try {
        const result = await callClaude([{ role: 'user', content: prompt }], '', 2000);
        const journals = JSON.parse(result.replace(/```json|```/g, '').trim());
        document.getElementById('journal-grid').innerHTML = '';
        journals.forEach(j => {
            const card = document.createElement('div'); card.className = 'journal-card';
            card.innerHTML = `<div class="journal-top"><div class="journal-abbr">${j.abbr}</div><div><div class="journal-name">${j.name}</div><div class="journal-publisher">${j.publisher}</div></div><span class="if-badge" style="margin-left:auto;">IF ${j.if}</span></div><div style="font-size:0.78rem;color:var(--text2);line-height:1.5;margin-bottom:6px;">${j.scope}</div><div style="font-size:0.74rem;color:var(--accent);margin-bottom:10px;">✦ ${j.fit}</div><div class="journal-meta"><div class="jm"><div class="jm-label">Style</div><div class="jm-val">${j.citation}</div></div><div class="jm"><div class="jm-label">Limit</div><div class="jm-val">${j.wordlimit}</div></div><div class="jm"><div class="jm-label">Review</div><div class="jm-val">${j.review_time}</div></div><div class="jm"><div class="jm-label">Indexed</div><div class="jm-val">${j.indexing}</div></div></div><div class="journal-guidelines">${j.guideline}</div><div style="display:flex;gap:8px;margin-top:12px;"><button class="btn btn-ghost" style="font-size:0.72rem;flex:1;" onclick="toggleGuidelines(this)">📋 Guidelines</button><button class="btn btn-primary" style="font-size:0.72rem;flex:1;" onclick="applyJournal('${j.name.replace(/'/g, "\\'")}','${j.citation}')">⚡ Apply</button></div>`;
            document.getElementById('journal-grid').appendChild(card);
        });
        showToast('✓ Found ' + journals.length + ' journals');
    } catch (e) {
        document.getElementById('journal-grid').innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--danger);">⚠ Error. Try again.</div>';
    }
    document.getElementById('journal-loading').style.display = 'none';
    document.getElementById('journal-btn').disabled = false;
}
function toggleGuidelines(btn) { const c = btn.closest('.journal-card'); c.classList.toggle('expanded'); btn.textContent = c.classList.contains('expanded') ? '▲ Hide' : '📋 Guidelines'; }
function applyJournal(name, cit) {
    document.getElementById('fmt-journal').value = name;
    const sel = document.getElementById('fmt-citation');
    for (let o of sel.options) { if (o.value.toLowerCase().includes(cit.toLowerCase())) { o.selected = true; break; } }
    showPanel('formatter'); showToast('✓ Journal applied!');
}

// ═══ LIT REVIEW ═══
function addSource() {
    const inp = document.getElementById('source-input'); const text = inp.value.trim();
    if (!text) return; inp.value = '';
    S.sources.push({ text, id: Date.now() }); renderSources(); showToast('✓ Source added');
}
function renderSources() {
    const list = document.getElementById('source-list');
    document.getElementById('source-count').textContent = S.sources.length + ' added';
    if (!S.sources.length) { list.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text3);font-size:0.8rem;">Add sources below</div>'; return; }
    list.innerHTML = '';
    S.sources.forEach((s, i) => {
        const rel = Math.floor(Math.random() * 30) + 60, color = rel > 80 ? 'var(--success)' : rel > 65 ? 'var(--accent)' : 'var(--gold)';
        const d = document.createElement('div'); d.className = 'source-item';
        d.innerHTML = `<div style="display:flex;justify-content:space-between;gap:6px;"><div class="source-title">${s.text.substring(0, 70)}${s.text.length > 70 ? '...' : ''}</div><button onclick="removeSource(${i})" style="background:none;border:none;color:var(--text3);cursor:pointer;">✕</button></div><div class="source-meta">[${i + 1}]</div><div class="rel-bar"><div class="rel-fill" style="width:${rel}%;background:${color};"></div></div>`;
        list.appendChild(d);
    });
}
function removeSource(i) { S.sources.splice(i, 1); renderSources(); }

async function generateLitReview() {
    if (!S.sources.length) { showToast('⚠ Add sources first'); return; }
    document.getElementById('litreview-loading').style.display = 'flex';
    document.getElementById('litreview-btn').disabled = true;
    document.getElementById('litreview-output').value = 'Generating...';
    const sourceList = S.sources.map((s, i) => `[${i + 1}] ${s.text}`).join('\n');
    const prompt = `Write a formal academic literature review (600-900 words) based on:\n${sourceList}\n\nInclude: intro paragraph, 2-3 thematic sections with ## headings, proper citations, research gaps, conclusion.`;
    try {
        const result = await callClaude([{ role: 'user', content: prompt }], '', 2000);
        document.getElementById('litreview-output').value = result;
        S.stats.reviews++; saveStats();
        showToast('✓ Review generated!');
    } catch (e) {
        document.getElementById('litreview-output').value = '⚠ Error. Try again.';
    }
    document.getElementById('litreview-loading').style.display = 'none';
    document.getElementById('litreview-btn').disabled = false;
}

// ═══ THESIS ═══
document.getElementById('thesis-input').addEventListener('input', function () {
    document.getElementById('thesis-wc').textContent = this.value.trim().split(/\s+/).filter(w => w).length + ' words';
});
function selectThesisOption(el) { document.querySelectorAll('#thesis-options .option-card').forEach(c => c.classList.remove('selected')); el.classList.add('selected'); }

async function convertThesis() {
    const input = document.getElementById('thesis-input').value.trim();
    if (!input) { showToast('⚠ Paste thesis first'); return; }
    const optEl = document.querySelector('#thesis-options .option-card.selected h4');
    const convType = optEl ? optEl.textContent : 'Full Chapter → Article';
    document.getElementById('thesis-progress').style.display = 'block';
    document.getElementById('thesis-btn').disabled = true;
    document.getElementById('thesis-output').style.display = 'none';
    document.getElementById('thesis-copy-btn').style.display = 'none';
    const msgs = ['Analyzing...', 'Identifying contributions...', 'Restructuring...', 'Refining...', 'Finalizing...'];
    let mi = 0; setStep(1, 'active');[2, 3, 4].forEach(n => setStep(n, ''));
    const iv = setInterval(() => { if (mi < msgs.length) { document.getElementById('thesis-progress-text').textContent = msgs[mi]; if (mi >= 1) { setStep(Math.min(mi + 1, 4), 'active'); setStep(mi, 'done'); } mi++; } }, 700);
    const prompt = `Convert this thesis to a journal article. Type: ${convType}, Journal: ${document.getElementById('thesis-journal').value || 'general'}, Citation: ${document.getElementById('thesis-citation').value}.\n\nThesis:\n"""\n${input.substring(0, 4000)}\n"""\n\nOutput: TITLE, ABSTRACT (250w structured), KEYWORDS, INTRODUCTION, METHODS, RESULTS, DISCUSSION, CONCLUSION, EDITOR'S NOTES.`;
    try {
        const result = await callClaude([{ role: 'user', content: prompt }], '', 3000);
        clearInterval(iv);[1, 2, 3, 4].forEach(n => setStep(n, 'done'));
        document.getElementById('thesis-progress').style.display = 'none';
        document.getElementById('thesis-output-text').textContent = result;
        document.getElementById('thesis-output').style.display = 'block';
        document.getElementById('thesis-copy-btn').style.display = 'flex';
        showToast('✓ Thesis converted!');
    } catch (e) {
        clearInterval(iv);
        document.getElementById('thesis-progress').style.display = 'none';
        document.getElementById('thesis-output-text').textContent = '⚠ Error: ' + e.message;
        document.getElementById('thesis-output').style.display = 'block';
    }
    document.getElementById('thesis-btn').disabled = false;
}
function setStep(n, cls) { const el = document.getElementById('step-' + n); if (el) el.className = 'step' + (cls ? ' ' + cls : ''); }
function copyThesisOutput() { navigator.clipboard.writeText(document.getElementById('thesis-output-text').textContent); showToast('✓ Copied!'); }

// ═══ UTILS ═══
function copyText(id) { const el = document.getElementById(id); navigator.clipboard.writeText(el.value || el.textContent); showToast('✓ Copied!'); }
function copyTextarea(id) { navigator.clipboard.writeText(document.getElementById(id).value); showToast('✓ Copied!'); }
let toastT;
function showToast(msg) { document.querySelector('.toast')?.remove(); clearTimeout(toastT); const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); toastT = setTimeout(() => t.remove(), 3500); }

init();
