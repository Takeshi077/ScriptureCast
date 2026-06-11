/**
 * ScriptureCast — Operator Dashboard JavaScript
 * Handles WebSocket communication, state management, and all UI interactions.
 */

// ── Configuration ──────────────────────────────────────────
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${wsProtocol}//${window.location.host}/ws`;

// ── DOM References ─────────────────────────────────────────
const connDot         = document.getElementById('conn-dot');
const connLabel       = document.getElementById('conn-label');
const connIndicator   = document.getElementById('connection-indicator');
const translationSel  = document.getElementById('translation-select');
const clearBtn        = document.getElementById('clear-btn');
const transcriptFeed  = document.getElementById('transcript-feed');
const micLiveLabel    = document.getElementById('mic-live-label');
const candidatesList  = document.getElementById('candidates-list');
const manualInput     = document.getElementById('manual-input');
const manualLookupBtn = document.getElementById('manual-lookup-btn');
const lookupPreview   = document.getElementById('lookup-preview');
const lookupRefLabel  = document.getElementById('lookup-reference-label');
const lookupTextPrev  = document.getElementById('lookup-text-preview');
const displayStatus   = document.getElementById('display-status');
const previewRef      = document.getElementById('preview-reference');
const previewText     = document.getElementById('preview-text');
const micToggleBtn    = document.getElementById('mic-toggle-btn');

// Fallback text input DOM
const textInputArea   = document.getElementById('text-input-area');
const textInput       = document.getElementById('text-input');
const textSendBtn     = document.getElementById('text-send-btn');

// ── State ──────────────────────────────────────────────────
let socket = null;
let currentCandidates = [];
let fullTranscript = '';
let interimText = '';
let transcriptNote = null;


// ── WebSocket ──────────────────────────────────────────────
let _reconnectTimer = null;

function connect() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        return;
    }

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
                // Server-sent transcript (from backend ASR)
                handleTranscript(msg.text, msg.is_final);
                break;
            case 'candidate_verses':
                handleCandidates(msg.candidates);
                break;
            case 'manual_verse_result':
                handleManualVerseResult(msg);
                break;
        }
    };

    socket.onclose = () => {
        setConnectionStatus('error');
        if (_reconnectTimer) clearTimeout(_reconnectTimer);
        _reconnectTimer = setTimeout(connect, 3000);
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

const MAX_NOTE_LENGTH = 10000;

// ── Continuous Note Display ─────────────────────────────────
function initContinuousNote() {
    if (transcriptNote) return;
    const placeholder = transcriptFeed.querySelector('.placeholder-text');
    if (placeholder) placeholder.remove();

    transcriptNote = document.createElement('div');
    transcriptNote.id = 'continuous-note';
    transcriptNote.className = 'continuous-note';
    transcriptFeed.appendChild(transcriptNote);
}

function updateTranscriptDisplay() {
    if (!transcriptNote) {
        initContinuousNote();
    }
    let display = fullTranscript;
    if (interimText) {
        display += ' ' + interimText;
    }
    // Keep tail end for performance — enough for full sermon context
    if (display.length > MAX_NOTE_LENGTH) {
        display = '… ' + display.slice(-MAX_NOTE_LENGTH);
    }
    transcriptNote.textContent = display || 'Waiting for audio input…';
    transcriptFeed.scrollTop = transcriptFeed.scrollHeight;
}

// ── AssemblyAI Streaming STT ──────────────────────────────
let isRecording = false;
let audioContext = null;
let scriptProcessor = null;
let source = null;
let mediaStream = null;
let aaiWs = null;

function hasSpeechSupport() {
    return !!(window.AudioContext || window.webkitAudioContext) && 
           !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

function setLiveLabel(show) {
    micLiveLabel.classList.toggle('active', show);
}

function showTextFallback() {
    textInputArea.classList.remove('hidden');
}

function downsampleBuffer(buffer, inputSampleRate, outputSampleRate) {
    if (inputSampleRate === outputSampleRate) {
        return buffer;
    }
    const ratio = inputSampleRate / outputSampleRate;
    const result = new Float32Array(Math.round(buffer.length / ratio));
    let writeOffset = 0;
    let readOffset = 0;
    while (writeOffset < result.length) {
        const nextReadOffset = Math.round((writeOffset + 1) * ratio);
        let accum = 0, count = 0;
        for (let i = readOffset; i < nextReadOffset && i < buffer.length; i++) {
            accum += buffer[i];
            count++;
        }
        result[writeOffset] = count > 0 ? accum / count : 0;
        writeOffset++;
        readOffset = nextReadOffset;
    }
    return result;
}

function float32ToInt16(buffer) {
    const l = buffer.length;
    const buf = new Int16Array(l);
    for (let i = 0; i < l; i++) {
        const s = Math.max(-1, Math.min(1, buffer[i]));
        buf[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return buf.buffer;
}

function initSpeechRecognition() {
    if (!hasSpeechSupport()) {
        setLiveLabel(false);
        micToggleBtn.disabled = true;
        micToggleBtn.title = 'Speech recording not supported in this browser';
        const placeholder = transcriptFeed.querySelector('.placeholder-text');
        if (placeholder) placeholder.textContent = 'Audio input is not supported in this browser. Type text below instead.';
        showTextFallback();
        return;
    }
    initContinuousNote();
}

async function startRecording() {
    if (isRecording) return;
    
    micToggleBtn.classList.add('connecting');
    micToggleBtn.title = 'Connecting to AssemblyAI...';
    
    // Create AudioContext IMMEDIATELY — before any await, to retain user gesture
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') {
        await audioContext.resume();
    }
    
    try {
        // 1. Get temporary token from backend
        const tokenResp = await fetch('/api/token');
        if (!tokenResp.ok) {
            throw new Error(`Failed to retrieve token: ${tokenResp.statusText}`);
        }
        const tokenData = await tokenResp.json();
        const token = tokenData.token;

        // 2. Access microphone
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                channelCount: 1
            }
        });

        // 3. Create audio pipeline
        source = audioContext.createMediaStreamSource(mediaStream);
        scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);

        // ScriptProcessorNode is deprecated — without connecting to destination,
        // modern browsers optimize away the audio graph and onaudioprocess never fires.
        // Use a zero-gain node to keep the graph alive without speaker feedback.
        const silentGain = audioContext.createGain();
        silentGain.gain.value = 0;

        scriptProcessor.onaudioprocess = (e) => {
            if (!isRecording) return;
            const inputData = e.inputBuffer.getChannelData(0);
            const downsampled = downsampleBuffer(inputData, audioContext.sampleRate, 16000);
            const pcm16 = float32ToInt16(downsampled);
            if (aaiWs && aaiWs.readyState === WebSocket.OPEN) {
                aaiWs.send(pcm16);
            }
        };

        // 4. Connect to AssemblyAI Streaming WebSocket
        // v3 API: use type field with Turn/Termination messages
        const wsUrl = `wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&format_turns=true&speech_model=u3-rt-pro&token=${token}`;
        aaiWs = new WebSocket(wsUrl);

        aaiWs.onopen = () => {
            micToggleBtn.classList.remove('connecting');
            micToggleBtn.classList.add('active');
            micToggleBtn.title = 'Click to stop live transcription';
            setLiveLabel(true);
            isRecording = true;

            source.connect(scriptProcessor);
            scriptProcessor.connect(silentGain);
            silentGain.connect(audioContext.destination);
        };

        aaiWs.onmessage = (event) => {
            const msg = JSON.parse(event.data);

            if (msg.type === 'Turn') {
                const text = msg.transcript || '';
                const isFinal = msg.end_of_turn;

                if (isFinal) {
                    interimText = '';
                    updateTranscriptDisplay();
                    if (text.trim()) {
                        send({ type: 'transcript', text: text.trim() });
                    }
                } else {
                    interimText = text;
                    updateTranscriptDisplay();
                    if (interimText) {
                        micToggleBtn.classList.add('speaking');
                    } else {
                        micToggleBtn.classList.remove('speaking');
                    }
                }
            } else if (msg.type === 'Termination') {
                console.warn('AssemblyAI session terminated:', msg.reason || msg.error);
            } else if (msg.error) {
                console.error('AssemblyAI error:', msg.error);
            }
        };

        aaiWs.onerror = (err) => {
            console.error('AssemblyAI WebSocket error:', err);
            appendStatusMessage('Live transcription connection failed. Check console for details.');
            stopRecording();
        };

        aaiWs.onclose = (event) => {
            console.log('AssemblyAI WebSocket closed:', event.code, event.reason);
            if (isRecording) {
                appendStatusMessage('Live transcription disconnected unexpectedly.');
                stopRecording();
            }
        };

    } catch (err) {
        console.error('Failed to start live transcription:', err);
        alert(`Error starting microphone: ${err.message}`);
        micToggleBtn.classList.remove('connecting', 'active');
        isRecording = false;
        setLiveLabel(false);
        showTextFallback();
    }
}

function stopRecording() {
    if (!isRecording) return;
    
    isRecording = false;
    micToggleBtn.classList.remove('active', 'speaking', 'connecting');
    micToggleBtn.title = 'Click to start live transcription';
    setLiveLabel(false);
    interimText = '';
    updateTranscriptDisplay();

    // Clean up audio context & streams
    if (scriptProcessor) {
        scriptProcessor.onaudioprocess = null;
        try { scriptProcessor.disconnect(); } catch {}
        scriptProcessor = null;
    }
    if (source) {
        try { source.disconnect(); } catch {}
        source = null;
    }
    if (mediaStream) {
        try {
            mediaStream.getTracks().forEach(track => track.stop());
        } catch {}
        mediaStream = null;
    }
    if (audioContext) {
        try { audioContext.close(); } catch {}
        audioContext = null;
    }

    // Terminate session gracefully
    if (aaiWs) {
        if (aaiWs.readyState === WebSocket.OPEN) {
            aaiWs.send(JSON.stringify({ type: 'Terminate' }));
            aaiWs.close();
        }
        aaiWs = null;
    }
}

function toggleRecording() {
    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
}

micToggleBtn.addEventListener('click', toggleRecording);


// ── State Update Handler ───────────────────────────────────
function handleStateUpdate(state) {
    if (state.current_translation) {
        translationSel.value = state.current_translation;
    }

    updateProjectorPreview(state.active_scripture);

    if (state.full_transcript && !fullTranscript && !interimText) {
        fullTranscript = state.full_transcript;
        if (fullTranscript.length > MAX_NOTE_LENGTH * 2) {
            fullTranscript = fullTranscript.slice(-MAX_NOTE_LENGTH);
        }
        updateTranscriptDisplay();
    }
}

// ── Transcript Handler ─────────────────────────────────────
function handleTranscript(text, isFinal) {
    if (!isFinal) {
        interimText = text;
        updateTranscriptDisplay();
        return;
    }
    interimText = '';
    const sep = fullTranscript ? ' ' : '';
    fullTranscript += sep + text;
    if (fullTranscript.length > MAX_NOTE_LENGTH * 2) {
        fullTranscript = fullTranscript.slice(-MAX_NOTE_LENGTH);
    }
    updateTranscriptDisplay();
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

    // Process in reverse so first array item (highest confidence) ends up at top
    // insertBefore(firstChild) reverses order, so we pre-reverse to cancel it out
    candidates.slice().reverse().forEach(candidate => {
        // Avoid duplicates already in list
        const refKey = `${candidate.book} ${candidate.chapter}:${candidate.verse_start ?? ''}`;
        const existing = document.querySelector(`[data-ref="${refKey}"]`);
        if (existing) return;

        const item = document.createElement('div');
        item.className = 'candidate-item';
        item.dataset.ref = refKey;

        const refStr = buildRefString(candidate);
        const confClass = candidate.confidence >= 85 ? 'conf-high' : candidate.confidence >= 65 ? 'conf-medium' : 'conf-low';
        const isSemantic = candidate.type === 'semantic';

        const typeLabel = isSemantic
            ? '<span class="candidate-type semantic">Quote</span>'
            : '<span class="candidate-type regex">Reference</span>';

        item.innerHTML = `
            <div class="candidate-row">
                <span class="candidate-ref">${escHtml(refStr)}</span>
                <span class="candidate-meta">
                    ${typeLabel}
                    <span class="candidate-confidence ${confClass}">${candidate.confidence}%</span>
                </span>
            </div>
            <div class="candidate-preview" id="prev-${escHtml(refStr).replace(/\s/g,'_')}">${isSemantic && candidate.text ? escHtml('"' + candidate.text + '"') : 'Loading…'}</div>
            <div class="candidate-actions">
                <button class="btn btn-primary disp-btn" aria-label="Display ${escHtml(refStr)} on projector">
                    <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M2 6a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/></svg>
                    Display Now
                </button>
                <button class="btn btn-secondary dismiss-btn" aria-label="Dismiss ${escHtml(refStr)}">Dismiss</button>
            </div>
        `;

        // Only fetch preview for regex matches (semantic already has text)
        if (!isSemantic) {
            fetchVersePreview(candidate, item.querySelector('.candidate-preview'));
        }

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

// ── Manual Verse Result Handler ─────────────────────────────
function handleManualVerseResult(msg) {
    lookupPreview.classList.remove('hidden');
    lookupRefLabel.textContent = msg.reference;
    lookupTextPrev.textContent = `"${msg.text}"`;
}

// ── Projector Preview Update ───────────────────────────────
function updateProjectorPreview(activeScripture) {
    if (activeScripture) {
        previewRef.textContent = activeScripture.reference;
        previewText.textContent = `"${activeScripture.text}"`;

        displayStatus.className = 'status-badge status-on';
        displayStatus.innerHTML = '<span class="status-dot"></span> Live';
    } else {
        previewRef.textContent = '—';
        previewText.textContent = 'Nothing on display';
        displayStatus.className = 'status-badge status-inactive';
        displayStatus.innerHTML = '<span class="status-dot"></span> Off';
    }
}

// ── Header Controls ────────────────────────────────────────
translationSel.addEventListener('change', () => {
    send({ type: 'set_translation', translation: translationSel.value });
});

clearBtn.addEventListener('click', () => {
    send({ type: 'clear' });
});

// ── Logout ──────────────────────────────────────────────────
const logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
        } catch {}
        localStorage.removeItem('token');
        window.location.href = '/login';
    });
}

// ── Fallback Text Input ────────────────────────────────────
textSendBtn.addEventListener('click', () => {
    const text = textInput.value.trim();
    if (!text) return;

    interimText = text;
    updateTranscriptDisplay();

    send({ type: 'transcript', text });
    textInput.value = '';
});

textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        textSendBtn.click();
    }
});

// ── Manual Verse Lookup ────────────────────────────────────
manualLookupBtn.addEventListener('click', () => {
    const text = manualInput.value.trim();
    if (!text) return;

    send({ type: 'manual_verse', verse_text: text });
    lookupPreview.classList.add('hidden');
    manualInput.value = '';
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

function appendStatusMessage(text) {
    const el = document.createElement('p');
    el.className = 'status-message';
    el.textContent = text;
    transcriptFeed.appendChild(el);
    transcriptFeed.scrollTop = transcriptFeed.scrollHeight;
}

// ── Boot ───────────────────────────────────────────────────
connect();
initContinuousNote();
initSpeechRecognition();
if (hasSpeechSupport()) {
    micToggleBtn.title = 'Click to start live sermon transcription (AssemblyAI)';
}
