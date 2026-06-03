/**
 * ScriptureCast — Operator Dashboard JavaScript
 * Handles WebSocket communication, state management, and all UI interactions.
 */

// ── Configuration ──────────────────────────────────────────
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${wsProtocol}//${window.location.host}/ws`;
const MAX_TRANSCRIPT_ITEMS = 25;

// ── DOM References ─────────────────────────────────────────
const connDot         = document.getElementById('conn-dot');
const connLabel       = document.getElementById('conn-label');
const connIndicator   = document.getElementById('connection-indicator');
const translationSel  = document.getElementById('translation-select');
const durationInput   = document.getElementById('duration-input');
const clearBtn        = document.getElementById('clear-btn');
const transcriptFeed  = document.getElementById('transcript-feed');
const micStatus       = document.getElementById('mic-status');
const simInput        = document.getElementById('sim-input');
const simSendBtn      = document.getElementById('sim-send-btn');
const candidatesList  = document.getElementById('candidates-list');
const manualInput     = document.getElementById('manual-input');
const manualLookupBtn = document.getElementById('manual-lookup-btn');
const lookupPreview   = document.getElementById('lookup-preview');
const lookupRefLabel  = document.getElementById('lookup-reference-label');
const lookupTextPrev  = document.getElementById('lookup-text-preview');
const displayStatus   = document.getElementById('display-status');
const previewRef      = document.getElementById('preview-reference');
const previewText     = document.getElementById('preview-text');
const countdownWrap   = document.getElementById('countdown-wrap');
const countdownLabel  = document.getElementById('countdown-label');
const countdownTimer  = document.getElementById('countdown-timer');
const countdownFill   = document.getElementById('countdown-bar-fill');
const micToggleBtn    = document.getElementById('mic-toggle-btn');

// ── State ──────────────────────────────────────────────────
let socket = null;
let countdownInterval = null;
let countdownRemaining = 0;
let displayDuration = 15;
let currentCandidates = [];

// ── WebSocket ──────────────────────────────────────────────
function connect() {
    setConnectionStatus('connecting');
    socket = new WebSocket(WS_URL);

    socket.onopen = () => {
        setConnectionStatus('connected');
    };

    socket.onmessage = (event) => {
        const msg = safeJson(event.data);
        if (!msg) return;

        switch (msg.type) {
            case 'state':
                handleStateUpdate(msg);
                break;
            case 'transcript':
                handleTranscript(msg.text, msg.is_final);
                break;
            case 'candidate_verses':
                handleCandidates(msg.candidates);
                break;
        }
    };

    socket.onclose = () => {
        setConnectionStatus('error');
        setTimeout(connect, 3000);
    };

    socket.onerror = () => {
        setConnectionStatus('error');
    };
}

function send(obj) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(obj));
    }
}

// ── Connection UI ──────────────────────────────────────────
function setConnectionStatus(status) {
    connIndicator.className = '';
    connIndicator.classList.add(status);
    if (status === 'connected') {
        connLabel.textContent = 'Connected';
    } else if (status === 'error') {
        connLabel.textContent = 'Disconnected — retrying…';
    } else {
        connLabel.textContent = 'Connecting…';
    }
}

// ── State Update Handler ───────────────────────────────────
function handleStateUpdate(state) {
    // Sync translation selector
    if (state.current_translation) {
        translationSel.value = state.current_translation;
    }

    // Sync display duration
    if (state.display_duration !== undefined) {
        displayDuration = state.display_duration;
        durationInput.value = displayDuration;
    }

    // Update projector preview
    updateProjectorPreview(state.active_scripture, state.display_duration);
}

// ── Transcript Handler ─────────────────────────────────────
function handleTranscript(text, isFinal) {
    // Show mic as active
    micStatus.className = 'status-badge status-active';
    micStatus.querySelector('.status-dot').textContent = '';

    const chunk = document.createElement('div');
    chunk.className = 'transcript-chunk' + (isFinal ? ' final' : '');
    chunk.textContent = text;

    // Remove placeholder if present
    const placeholder = transcriptFeed.querySelector('.placeholder-text');
    if (placeholder) placeholder.remove();

    transcriptFeed.appendChild(chunk);
    transcriptFeed.scrollTop = transcriptFeed.scrollHeight;

    // Trim old chunks
    const chunks = transcriptFeed.querySelectorAll('.transcript-chunk');
    if (chunks.length > MAX_TRANSCRIPT_ITEMS) {
        chunks[0].remove();
    }
}

// ── Candidate Verses Handler ───────────────────────────────
function handleCandidates(candidates) {
    currentCandidates = candidates;
    renderCandidates(candidates);
}

function renderCandidates(candidates) {
    if (!candidates || candidates.length === 0) return;

    // Remove placeholder
    const placeholder = candidatesList.querySelector('.placeholder-text');
    if (placeholder) placeholder.remove();

    // Mark transcript entries that matched
    document.querySelectorAll('.transcript-chunk.final:last-child').forEach(el => {
        el.classList.add('has-match');
    });

    candidates.forEach(candidate => {
        // Avoid duplicates already in list
        const existing = document.querySelector(`[data-ref="${candidate.book} ${candidate.chapter}:${candidate.verse_start}"]`);
        if (existing) return;

        const item = document.createElement('div');
        item.className = 'candidate-item';
        item.dataset.ref = `${candidate.book} ${candidate.chapter}:${candidate.verse_start}`;

        const refStr = buildRefString(candidate);
        const confClass = candidate.confidence >= 85 ? 'conf-high' : candidate.confidence >= 65 ? 'conf-medium' : 'conf-low';

        item.innerHTML = `
            <div class="candidate-row">
                <span class="candidate-ref">${escHtml(refStr)}</span>
                <span class="candidate-confidence ${confClass}">${candidate.confidence}%</span>
            </div>
            <div class="candidate-preview" id="prev-${escHtml(refStr).replace(/\s/g,'_')}">Loading…</div>
            <div class="candidate-actions">
                <button class="btn btn-primary disp-btn" aria-label="Display ${escHtml(refStr)} on projector">
                    <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M2 6a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/></svg>
                    Display Now
                </button>
                <button class="btn btn-secondary dismiss-btn" aria-label="Dismiss ${escHtml(refStr)}">Dismiss</button>
            </div>
        `;

        // Fetch verse preview text
        fetchVersePreview(candidate, item.querySelector('.candidate-preview'));

        // Display Now button
        item.querySelector('.disp-btn').addEventListener('click', () => {
            displayCandidate(candidate);
            item.classList.add('active-candidate');
        });

        // Dismiss button
        item.querySelector('.dismiss-btn').addEventListener('click', () => {
            item.style.opacity = '0';
            item.style.transform = 'translateX(-10px)';
            setTimeout(() => item.remove(), 200);
        });

        // Insert at top (most recent first)
        candidatesList.insertBefore(item, candidatesList.firstChild);

        // Cap the list at 8 candidates
        const allItems = candidatesList.querySelectorAll('.candidate-item');
        if (allItems.length > 8) {
            allItems[allItems.length - 1].remove();
        }
    });
}

function buildRefString(candidate) {
    let ref = `${candidate.book} ${candidate.chapter}`;
    if (candidate.verse_start) {
        ref += `:${candidate.verse_start}`;
        if (candidate.verse_end) ref += `-${candidate.verse_end}`;
    }
    return ref;
}

async function fetchVersePreview(candidate, el) {
    const book = encodeURIComponent(candidate.book);
    const chapter = candidate.chapter;
    const verse = candidate.verse_start || 1;
    try {
        const resp = await fetch(`/api/verse?book=${book}&chapter=${chapter}&verse=${verse}`);
        const data = await resp.json();
        if (data.error || !data.verses || data.verses.length === 0) {
            el.textContent = 'Preview unavailable';
        } else {
            el.textContent = `"${data.verses[0].text}"`;
        }
    } catch {
        el.textContent = 'Preview unavailable';
    }
}

function displayCandidate(candidate) {
    send({
        type: 'manual_verse',
        verse_text: buildRefString(candidate)
    });
}

// ── Projector Preview Update ───────────────────────────────
function updateProjectorPreview(activeScripture, duration) {
    clearCountdown();

    if (activeScripture) {
        previewRef.textContent = activeScripture.reference;
        previewText.textContent = `"${activeScripture.text}"`;

        displayStatus.className = 'status-badge status-on';
        displayStatus.innerHTML = '<span class="status-dot"></span> Live';

        // Start countdown if duration set
        if (duration && duration > 0) {
            startCountdown(duration);
        }
    } else {
        previewRef.textContent = '—';
        previewText.textContent = 'Nothing on display';
        displayStatus.className = 'status-badge status-inactive';
        displayStatus.innerHTML = '<span class="status-dot"></span> Off';
        countdownFill.style.width = '0%';
        countdownTimer.textContent = '—';
    }
}

function startCountdown(seconds) {
    countdownRemaining = seconds;
    countdownFill.style.width = '100%';
    countdownTimer.textContent = seconds;

    countdownInterval = setInterval(() => {
        countdownRemaining--;
        const pct = Math.max(0, (countdownRemaining / seconds) * 100);
        countdownFill.style.width = `${pct}%`;
        countdownTimer.textContent = countdownRemaining > 0 ? countdownRemaining : '—';

        if (countdownRemaining <= 0) clearCountdown();
    }, 1000);
}

function clearCountdown() {
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
}

// ── Header Controls ────────────────────────────────────────
translationSel.addEventListener('change', () => {
    send({ type: 'set_translation', translation: translationSel.value });
});

durationInput.addEventListener('change', () => {
    const val = parseInt(durationInput.value, 10);
    if (!isNaN(val) && val >= 0) {
        send({ type: 'set_duration', duration: val });
    }
});

clearBtn.addEventListener('click', () => {
    send({ type: 'clear' });
});

// ── Simulated Speech ───────────────────────────────────────
simSendBtn.addEventListener('click', () => {
    const text = simInput.value.trim();
    if (!text) return;

    // Show it in transcript feed as if it were real audio
    handleTranscript(text, true);

    // Send to backend for verse detection
    send({ type: 'simulated_speech', text });

    simInput.value = '';
});

simInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        simSendBtn.click();
    }
});

// ── Manual Verse Lookup ────────────────────────────────────
manualLookupBtn.addEventListener('click', () => {
    const text = manualInput.value.trim();
    if (!text) return;

    send({ type: 'manual_verse', verse_text: text });
    lookupPreview.classList.add('hidden');
});

manualInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') manualLookupBtn.click();
});

// ── Utilities ──────────────────────────────────────────────
function safeJson(str) {
    try { return JSON.parse(str); } catch { return null; }
}

function escHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ── Boot ───────────────────────────────────────────────────
connect();
