/**
 * ScriptureCast — Operator Dashboard JavaScript
 * Handles WebSocket communication, state management, and all UI interactions.
 */
(function() {
    const errDiv = document.createElement('div');
    errDiv.id = 'js-error-banner';
    errDiv.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#dc2626;color:#fff;padding:12px;font-size:14px;z-index:99999;font-family:monospace;display:none';
    document.body.prepend(errDiv);
    window.addEventListener('error', function(e) {
        errDiv.textContent = 'JS Error: ' + (e.message || e.error || 'unknown');
        errDiv.style.display = 'block';
    });
    window.addEventListener('unhandledrejection', function(e) {
        errDiv.textContent = 'Unhandled Promise: ' + (e.reason || 'unknown');
        errDiv.style.display = 'block';
    });
})();

const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = (window.__TAURI__ !== undefined)
    ? 'wss://scripturecast.onrender.com/ws'
    : `${wsProtocol}//${window.location.host}/ws`;

const BASE_URL = (window.__TAURI__ !== undefined) ? 'https://scripturecast.onrender.com' : '';

async function tauriInvoke(cmd, args) {
    if (!window.__TAURI_INTERNALS__) throw new Error('Not in Tauri context');
    return window.__TAURI__.core.invoke(cmd, args);
}

let whisperStatus = null;

async function checkWhisperStatus() {
    if (!window.__TAURI_INTERNALS__) return null;
    try {
        whisperStatus = await tauriInvoke('check_whisper');
        return whisperStatus;
    } catch {
        whisperStatus = { available: false, sidecar_exists: false, model_exists: false };
        return whisperStatus;
    }
}

// ── DOM References ─────────────────────────────────────────
const connDot = document.getElementById('conn-dot');
const connLabel = document.getElementById('conn-label');
const connIndicator = document.getElementById('connection-indicator');
const translationSel = document.getElementById('translation-select');
const clearBtn = document.getElementById('clear-btn');
const transcriptFeed = document.getElementById('transcript-feed');
const micLiveLabel = document.getElementById('mic-live-label');
const candidatesList = document.getElementById('candidates-list');
const manualInput = document.getElementById('manual-input');
const manualLookupBtn = document.getElementById('manual-lookup-btn');
const lookupPreview = document.getElementById('lookup-preview');
const lookupRefLabel = document.getElementById('lookup-reference-label');
const lookupTextPrev = document.getElementById('lookup-text-preview');
const displayStatus = document.getElementById('display-status');
const previewRef = document.getElementById('preview-reference');
const previewText = document.getElementById('preview-text');
const micToggleBtn = document.getElementById('mic-toggle-btn');
const dashPrevBtn = document.getElementById('dash-prev-btn');
const dashNextBtn = document.getElementById('dash-next-btn');
const dashVersePos = document.getElementById('dash-verse-position');
const dashNavEl = document.getElementById('dash-verse-nav');

// Fallback text input DOM
const textInputArea = document.getElementById('text-input-area');
const textInput = document.getElementById('text-input');
const textSendBtn = document.getElementById('text-send-btn');

// Image upload DOM
const imagesFileInput = document.getElementById('images-file-input');
const imagesGallery = document.getElementById('images-gallery');
const imagesUploadLabel = document.getElementById('images-upload-label');

// ── State ──────────────────────────────────────────────────
let socket = null;
let currentCandidates = [];
let fullTranscript = '';
let interimText = '';
let transcriptNote = null;
let currentVerseIndex = 0;
let _activeScripture = null;
let uploadedImages = [];
let _activeImage = null;


// ── WebSocket ──────────────────────────────────────────────
let _reconnectTimer = null;

async function getToken() {
    // localStorage is fastest and set by auth.js on login — check it first
    const local = localStorage.getItem('token');
    if (local) return local;

    // Fall back to cookie (set by login response as httponly)
    const cookie = document.cookie.split(';').find(c => c.trim().startsWith('access_token='))?.split('=')[1];
    if (cookie) return cookie;

    // Last resort: Tauri persistent store (for restarts, etc.)
    if (window.__TAURI__) {
        try {
            return await window.__TAURI__.core.invoke('get_auth_token');
        } catch(e) {
            console.log('Tauri store failed', e);
        }
    }
    return null;
}

async function connect() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        return;
    }

    setConnectionStatus('connecting');
    let token;
    try {
        token = await getToken();
    } catch {
        token = null;
    }
    const urlWithToken = token ? `${WS_URL}?token=${encodeURIComponent(token)}` : WS_URL;
    socket = new WebSocket(urlWithToken);

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
    if (show) {
        micLiveLabel.textContent = 'Live ●';
    } else {
        micLiveLabel.textContent = 'Mic';
    }
}

function showTextFallback() {
    textInputArea.classList.remove('hidden');
}

// ── Local Whisper Recording Mode ──────────────────────────
let isWhisperRecording = false;
let whisperMediaRecorder = null;
let whisperAudioChunks = [];

async function startWhisperRecording() {
    if (isWhisperRecording) return;
    if (!whisperStatus?.available) {
        appendStatusMessage('Whisper not available. Check model and sidecar.');
        return;
    }

    micToggleBtn.classList.add('connecting');
    micToggleBtn.title = 'Starting local recording…';

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }
        });

        whisperMediaRecorder = new MediaRecorder(stream, {
            mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : 'audio/webm'
        });
        whisperAudioChunks = [];

        whisperMediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) whisperAudioChunks.push(e.data);
        };

        whisperMediaRecorder.onstop = async () => {
            stream.getTracks().forEach(t => t.stop());

            micToggleBtn.classList.add('connecting');
            micToggleBtn.title = 'Decoding audio…';
            setLiveLabel(false);

            const blob = new Blob(whisperAudioChunks, { type: 'audio/webm' });

            // Decode WebM/Opus to raw PCM via AudioContext, then encode as WAV
            try {
                const arrayBuffer = await blob.arrayBuffer();
                const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
                audioCtx.close();

                const numChannels = audioBuffer.numberOfChannels;
                const sampleRate = audioBuffer.sampleRate;
                const length = audioBuffer.length;
                const pcmData = new Float32Array(length);
                const channelData = audioBuffer.getChannelData(0);
                pcmData.set(channelData);

                const wavBytes = encodeWav(pcmData, sampleRate, numChannels);
                const base64 = arrayBufferToBase64(wavBytes.buffer);

                micToggleBtn.title = 'Transcribing…';
                const text = await tauriInvoke('transcribe_audio', {
                    audioBase64: base64
                });
                if (text.trim()) {
                    fullTranscript += (fullTranscript ? ' ' : '') + text.trim();
                    if (fullTranscript.length > MAX_NOTE_LENGTH * 2) {
                        fullTranscript = fullTranscript.slice(-MAX_NOTE_LENGTH);
                    }
                    updateTranscriptDisplay();
                    send({ type: 'transcript', text: text.trim() });
                }
            } catch (err) {
                appendStatusMessage(`Transcription error: ${err}`);
            }

            micToggleBtn.classList.remove('active', 'connecting', 'speaking');
            micToggleBtn.title = 'Click to start recording (Local Whisper)';
        };

        whisperMediaRecorder.start();
        isWhisperRecording = true;
        micToggleBtn.classList.remove('connecting');
        micToggleBtn.classList.add('active');
        micToggleBtn.title = 'Click to stop recording';
        setLiveLabel(true);
        initContinuousNote();
    } catch (err) {
        appendStatusMessage(`Microphone error: ${err.message}`);
        micToggleBtn.classList.remove('active', 'connecting');
        showTextFallback();
    }
}

function stopWhisperRecording() {
    if (!isWhisperRecording) return;
    isWhisperRecording = false;
    if (whisperMediaRecorder && whisperMediaRecorder.state !== 'inactive') {
        whisperMediaRecorder.stop();
    }
    whisperMediaRecorder = null;
}

function encodeWav(samples, sampleRate, numChannels) {
    const bitsPerSample = 16;
    const blockAlign = numChannels * bitsPerSample / 8;
    const dataSize = samples.length * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    function s(offset, str) {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }
    function w(offset, v) { view.setUint16(offset, v, true); }
    function d(offset, v) { view.setUint32(offset, v, true); }

    s(0, 'RIFF');
    d(4, 36 + dataSize);
    s(8, 'WAVE');
    s(12, 'fmt ');
    d(16, 16);
    w(20, 1);
    w(22, numChannels);
    d(24, sampleRate);
    d(28, sampleRate * blockAlign);
    w(32, blockAlign);
    w(34, bitsPerSample);
    s(36, 'data');
    d(40, dataSize);

    const int16 = new Int16Array(buffer, 44, samples.length);
    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    return new Uint8Array(buffer);
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
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

    if (!!(window.__TAURI_INTERNALS__)) {
        checkWhisperStatus().then(status => {
            if (!status?.available && status?.sidecar_exists) {
                micToggleBtn.title = 'Whisper model missing — click to download';
            }
        });
    }
    micToggleBtn.title = 'Click to start live sermon transcription (AssemblyAI)';
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
        const tokenResp = await fetch(`${BASE_URL}/api/token`);
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

            clearMicErrors();
            showProjectorToast('success', 'Microphone reconnected');
            setTimeout(() => {
                const toast = document.getElementById('projector-toast');
                if (toast) toast.classList.add('hidden');
            }, 2000);
        };

        aaiWs.onmessage = (event) => {
            const msg = JSON.parse(event.data);

            if (msg.type === 'Turn') {
                const text = msg.transcript || '';
                const isFinal = msg.end_of_turn;

                if (isFinal) {
                    interimText = '';
                    updateTranscriptDisplay();
                    micToggleBtn.classList.remove('speaking');
                    micLiveLabel.classList.remove('speaking');
                    if (text.trim()) {
                        send({ type: 'transcript', text: text.trim() });
                    }
                } else {
                    interimText = text;
                    updateTranscriptDisplay();
                    if (interimText) {
                        micToggleBtn.classList.add('speaking');
                        micLiveLabel.classList.add('speaking');
                    } else {
                        micToggleBtn.classList.remove('speaking');
                        micLiveLabel.classList.remove('speaking');
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
            appendMicError('Microphone disconnected. Reconnecting...');
            stopRecording();
        };

        aaiWs.onclose = (event) => {
            console.log('AssemblyAI WebSocket closed:', event.code, event.reason);
            if (isRecording) {
                appendMicError('Microphone disconnected. Reconnecting...');
                stopRecording();
            }
        };

    } catch (err) {
        alert('Recording error: ' + err.message);
        console.error('Recording error:', err);
        micToggleBtn.classList.remove('connecting');
        micToggleBtn.title = 'Click to start recording';
    }
}

function stopRecording() {
    if (!isRecording) return;

    isRecording = false;
    micToggleBtn.classList.remove('active', 'speaking', 'connecting');
    micLiveLabel.classList.remove('speaking');
    micToggleBtn.title = 'Click to start live transcription';
    setLiveLabel(false);
    interimText = '';
    updateTranscriptDisplay();

    // Clean up audio context & streams
    if (scriptProcessor) {
        scriptProcessor.onaudioprocess = null;
        try { scriptProcessor.disconnect(); } catch { }
        scriptProcessor = null;
    }
    if (source) {
        try { source.disconnect(); } catch { }
        source = null;
    }
    if (mediaStream) {
        try {
            mediaStream.getTracks().forEach(track => track.stop());
        } catch { }
        mediaStream = null;
    }
    if (audioContext) {
        try { audioContext.close(); } catch { }
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
    } else if (isWhisperRecording) {
        stopWhisperRecording();
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

    _activeScripture = state.active_scripture;
    _activeImage = state.active_image;
    currentVerseIndex = state.current_verse_index ?? 0;
    updateProjectorPreview(state.active_scripture, state.active_image);
    updateChapterBrowser(state.active_scripture);

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
            <div class="candidate-preview" id="prev-${escHtml(refStr).replace(/\s/g, '_')}">${isSemantic && candidate.text ? escHtml('"' + candidate.text + '"') : 'Loading…'}</div>
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
    const verseStart = candidate.verse_start || 1;
    const verseEnd = candidate.verse_end || '';
    let url = `${BASE_URL}/api/verse?book=${book}&chapter=${chapter}&verse=${verseStart}`;
    if (verseEnd) {
        url += `&verse_end=${verseEnd}`;
    }
    try {
        const resp = await fetch(url);
        const data = await resp.json();
        if (data.error || !data.verses || data.verses.length === 0) {
            el.textContent = 'Preview unavailable';
        } else {
            el.innerHTML = '';
            data.verses.forEach(v => {
                const verseSpan = document.createElement('span');
                verseSpan.className = 'verse-span';

                const numSup = document.createElement('sup');
                numSup.className = 'verse-num-preview';
                numSup.textContent = v.verse;

                const textSpan = document.createElement('span');
                textSpan.textContent = v.text + ' ';

                verseSpan.appendChild(numSup);
                verseSpan.appendChild(textSpan);
                el.appendChild(verseSpan);
            });
        }
    } catch {
        el.textContent = 'Preview unavailable';
    }
}

function displayCandidate(candidate) {
    const ref = buildRefString(candidate);
    if (socket && socket.readyState === WebSocket.OPEN) {
        send({ type: 'manual_verse', verse_text: ref });
    } else if (window.__TAURI_INTERNALS__) {
        doManualVerseLookup(ref);
    }
}

// ── Manual Verse Result Handler ─────────────────────────────
function handleManualVerseResult(msg) {
    lookupPreview.classList.remove('hidden');
    lookupRefLabel.textContent = msg.reference;

    lookupTextPrev.innerHTML = '';
    if (msg.verses && msg.verses.length > 0) {
        msg.verses.forEach(v => {
            const verseDiv = document.createElement('div');
            verseDiv.className = 'verse-block';

            const numSup = document.createElement('sup');
            numSup.className = 'verse-num';
            numSup.textContent = v.verse;

            const textSpan = document.createElement('span');
            textSpan.className = 'verse-text';
            textSpan.textContent = v.text;

            verseDiv.appendChild(numSup);
            verseDiv.appendChild(document.createTextNode(' '));
            verseDiv.appendChild(textSpan);
            lookupTextPrev.appendChild(verseDiv);
        });
    } else {
        const verseDiv = document.createElement('div');
        verseDiv.className = 'verse-block';

        const textSpan = document.createElement('span');
        textSpan.className = 'verse-text';
        textSpan.textContent = msg.text;

        verseDiv.appendChild(textSpan);
        lookupTextPrev.appendChild(verseDiv);
    }
}

// ── Projector Preview Update ───────────────────────────────
function updateProjectorPreview(activeScripture, activeImage) {
    if (activeImage && !activeScripture) {
        previewRef.textContent = 'Image';
        previewText.innerHTML = `<img src="${escHtml(activeImage)}" style="max-width:100%;max-height:120px;border-radius:6px;object-fit:contain;margin-top:6px;">`;
        displayStatus.className = 'status-badge status-on';
        displayStatus.innerHTML = '<span class="status-dot"></span> Image';
        dashNavEl.classList.add('hidden');
        return;
    }

    if (!activeScripture) {
        previewRef.textContent = '—';
        previewText.textContent = 'Nothing on display';
        displayStatus.className = 'status-badge status-inactive';
        displayStatus.innerHTML = '<span class="status-dot"></span> Off';
        dashNavEl.classList.add('hidden');
        return;
    }

    displayStatus.className = 'status-badge status-on';
    displayStatus.innerHTML = '<span class="status-dot"></span> Live';

    const verses = activeScripture.verses;
    const hasMultiple = verses && verses.length > 1;

    if (hasMultiple && currentVerseIndex >= verses.length) {
        currentVerseIndex = 0;
    }

    if (hasMultiple) {
        const v = verses[currentVerseIndex];
        previewRef.textContent = `${activeScripture.book} ${activeScripture.chapter}:${v.verse}`;

        previewText.innerHTML = '';
        const verseDiv = document.createElement('div');
        verseDiv.className = 'verse-block';
        const numSup = document.createElement('sup');
        numSup.className = 'verse-num';
        numSup.textContent = v.verse;
        const textSpan = document.createElement('span');
        textSpan.className = 'verse-text';
        textSpan.textContent = v.text;
        verseDiv.appendChild(numSup);
        verseDiv.appendChild(document.createTextNode(' '));
        verseDiv.appendChild(textSpan);
        previewText.appendChild(verseDiv);

        dashVersePos.textContent = `Verse ${currentVerseIndex + 1} of ${verses.length}`;
        dashPrevBtn.disabled = currentVerseIndex === 0;
        dashNextBtn.disabled = currentVerseIndex === verses.length - 1;
        dashNavEl.classList.remove('hidden');
    } else {
        previewRef.textContent = activeScripture.reference;
        previewText.innerHTML = '';
        if (verses && verses.length > 0) {
            verses.forEach(v => {
                const verseDiv = document.createElement('div');
                verseDiv.className = 'verse-block';
                const numSup = document.createElement('sup');
                numSup.className = 'verse-num';
                numSup.textContent = v.verse;
                const textSpan = document.createElement('span');
                textSpan.className = 'verse-text';
                textSpan.textContent = v.text;
                verseDiv.appendChild(numSup);
                verseDiv.appendChild(document.createTextNode(' '));
                verseDiv.appendChild(textSpan);
                previewText.appendChild(verseDiv);
            });
        } else {
            const verseDiv = document.createElement('div');
            verseDiv.className = 'verse-block';
            const textSpan = document.createElement('span');
            textSpan.className = 'verse-text';
            textSpan.textContent = activeScripture.text;
            verseDiv.appendChild(textSpan);
            previewText.appendChild(verseDiv);
        }
        dashNavEl.classList.add('hidden');
    }
}

// ── Verse Navigation ────────────────────────────────────────
function goToPrevVerse() {
    const verses = _activeScripture?.verses;
    if (!verses || verses.length <= 1 || currentVerseIndex <= 0) return;
    currentVerseIndex--;
    send({ type: 'verse_navigate', verse_index: currentVerseIndex });
    updateProjectorPreview(_activeScripture, _activeImage);
}

function goToNextVerse() {
    const verses = _activeScripture?.verses;
    if (!verses || verses.length <= 1 || currentVerseIndex >= verses.length - 1) return;
    currentVerseIndex++;
    send({ type: 'verse_navigate', verse_index: currentVerseIndex });
    updateProjectorPreview(_activeScripture, _activeImage);
}

dashPrevBtn.addEventListener('click', goToPrevVerse);
dashNextBtn.addEventListener('click', goToNextVerse);

document.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'ArrowLeft') { goToPrevVerse(); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { goToNextVerse(); e.preventDefault(); }
});

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
            await fetch(`${BASE_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' });
        } catch { }
        localStorage.removeItem('token');
        if (window.__TAURI__) {
            try { await window.__TAURI__.core.invoke('remove_auth_token'); } catch { }
        }
        window.location.href = '/';
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
    manualInput.value = '';
    doManualVerseLookup(text);
});

manualInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') manualLookupBtn.click();
});

async function doManualVerseLookup(text) {
    // Try online first (WebSocket connected)
    if (socket && socket.readyState === WebSocket.OPEN) {
        send({ type: 'manual_verse', verse_text: text });
        lookupPreview.classList.add('hidden');
        return;
    }

    // Fall back to offline via Tauri invoke
    if (window.__TAURI_INTERNALS__) {
        lookupPreview.classList.add('hidden');
        try {
            const translation = translationSel.value;
            const result = await tauriInvoke('lookup_verse_text', { text, translation });
            handleManualVerseResult({
                reference: result.reference,
                verses: result.verses,
                text: result.combined_text || ''
            });

            // Emit event for screen window
            try {
                await window.__TAURI__.event.emit('verse-update', {
                    active_scripture: {
                        reference: result.reference,
                        text: result.combined_text,
                        verses: result.verses,
                        book: result.book,
                        chapter: result.chapter,
                        verse_start: result.verses?.[0]?.verse || 1
                    },
                    active_image: null,
                    current_verse_index: 0
                });
            } catch { }
        } catch (err) {
            lookupPreview.classList.remove('hidden');
            lookupRefLabel.textContent = 'Lookup Error';
            lookupTextPrev.textContent = String(err);
        }
        return;
    }

    // No WebSocket and no Tauri
    lookupPreview.classList.remove('hidden');
    lookupRefLabel.textContent = 'Offline';
    lookupTextPrev.textContent = 'Cannot look up verse without a network connection.';
}

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

function appendMicError(text) {
    const el = document.createElement('p');
    el.className = 'status-message mic-error';
    el.textContent = text;
    transcriptFeed.appendChild(el);
    transcriptFeed.scrollTop = transcriptFeed.scrollHeight;
}

function clearMicErrors() {
    transcriptFeed.querySelectorAll('.mic-error').forEach(el => el.remove());
}

// ── Model Download ──────────────────────────────────────────
const WHISPER_MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin';

async function downloadWhisperModel() {
    if (!window.__TAURI_INTERNALS__) return;
    micToggleBtn.disabled = true;
    micToggleBtn.title = 'Downloading model…';
    micToggleBtn.classList.add('connecting');

    try {
        const resp = await fetch(WHISPER_MODEL_URL);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const contentLength = resp.headers.get('content-length');
        const reader = resp.body.getReader();
        const chunks = [];
        let received = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            if (contentLength) {
                const pct = Math.round((received / parseInt(contentLength)) * 100);
                micToggleBtn.title = `Downloading model… ${pct}%`;
            }
        }

        const allBytes = new Uint8Array(received);
        let offset = 0;
        for (const chunk of chunks) {
            allBytes.set(chunk, offset);
            offset += chunk.length;
        }

        const base64 = arrayBufferToBase64(allBytes.buffer);
        const path = await tauriInvoke('write_model_file', { dataBase64: base64 });
        await checkWhisperStatus();

        if (whisperStatus?.available) {
            micToggleBtn.title = 'Click to start recording (Local Whisper)';
            appendStatusMessage('Model downloaded. Local Whisper ready!');
        } else {
            micToggleBtn.title = 'Model download complete — but whisper not available';
        }
    } catch (err) {
        appendStatusMessage(`Model download failed: ${err.message}`);
        micToggleBtn.title = 'Download failed — click to retry';
    } finally {
        micToggleBtn.disabled = false;
        micToggleBtn.classList.remove('connecting');
    }
}

// ── Display / Projector Detection ──────────────────────────
async function getDisplays() {
    if (window.__TAURI_INTERNALS__) {
        try {
            return await tauriInvoke('get_displays');
        } catch { return []; }
    }
    if (window.screen.isExtended && navigator.getScreenDetails) {
        try {
            const d = await navigator.getScreenDetails();
            return d.screens.map(s => ({
                name: s.label,
                x: s.availLeft,
                y: s.availTop,
                width: s.availWidth,
                height: s.availHeight,
                is_primary: s.isPrimary,
            }));
        } catch { }
    }
    return [{
        name: 'Primary display',
        x: screenLeft || 0,
        y: screenTop || 0,
        width: screen.availWidth,
        height: screen.availHeight,
        is_primary: true,
    }];
}

let displayWatchInterval = null;

function startDisplayWatch() {
    if (window.__TAURI_INTERNALS__) {
        let known = 0;
        displayWatchInterval = setInterval(async () => {
            try {
                const list = await tauriInvoke('get_displays');
                if (known === 0) { known = list.length; return; }
                if (list.length > known) {
                    known = list.length;
                    const ext = list.find(d => !d.is_primary);
                    showProjectorToast('info',
                        `Display detected${ext ? `: "${ext.name || 'HDMI projector'}"` : ''}. ` +
                        'Click "Open Projector Screen" to use it.');
                }
            } catch { }
        }, 3000);
        return;
    }
    if (navigator.getScreenDetails) {
        navigator.getScreenDetails().then(d => {
            let known = d.screens.length;
            d.onscreenschange = () => {
                if (d.screens.length > known) {
                    known = d.screens.length;
                    showProjectorToast('info',
                        'New display detected. Click "Open Projector Screen" to use it.');
                }
            };
        }).catch(() => { });
    }
    if (window.screen.isExtended) {
        showProjectorToast('info',
            'Multiple displays detected. Click "Open Projector Screen" for the projector.');
    }
}

// ── Projector Screen Management ────────────────────────────
// Tauri-specific state
let projectorOpen = false;
let identifying = false;

// Browser fallback state
let projectorWindow = null;
let projectorCheckInterval = null;

// ── Tauri: Display enumeration ──
async function loadDisplays() {
    if (!window.__TAURI_INTERNALS__) return;
    try {
        const displays = await tauriInvoke('get_available_displays');
        const select = document.getElementById('display-select');
        if (!select) return;
        select.innerHTML = '';

        const autoOpt = document.createElement('option');
        autoOpt.value = '';
        autoOpt.textContent = 'Auto-Detect (secondary display)';
        select.appendChild(autoOpt);

        for (const d of displays) {
            const opt = document.createElement('option');
            opt.value = d.id;
            const label = d.name ? d.name : `Display ${d.id.replace('display-', '')}`;
            opt.textContent = `${label} — ${d.width}×${d.height}${d.is_primary ? ' (Primary)' : ''}`;
            if (!d.is_primary) opt.selected = true;
            select.appendChild(opt);
        }
    } catch (e) {
        console.error('Failed to load displays:', e);
    }
}

// ── Tauri: Identify displays ──
async function identifyDisplays() {
    if (!window.__TAURI_INTERNALS__ || identifying) return;
    identifying = true;
    const btn = document.getElementById('identify-displays-btn');
    if (btn) btn.style.opacity = '0.5';
    try {
        await tauriInvoke('identify_displays');
    } catch (e) {
        console.error('Identify failed:', e);
    }
    identifying = false;
    if (btn) btn.style.opacity = '1';
}

// ── Tauri: Open projector on selected display ──
async function openProjectorOnDisplay() {
    const btn = document.getElementById('open-projector-btn');
    if (!btn) return;
    btn.classList.add('loading');

    try {
        const select = document.getElementById('display-select');
        let displayId = select ? select.value : '';

        if (!displayId) {
            const displays = await tauriInvoke('get_available_displays');
            const secondary = displays.find(d => !d.is_primary);
            displayId = secondary ? secondary.id : (displays[0] ? displays[0].id : 'display-1');
        }

        await tauriInvoke('open_projector_on_display', { displayId });
        projectorOpen = true;
        updateOutputsButton(true);
        showProjectorToast('success', 'Projector opened on selected display');
    } catch (e) {
        showProjectorToast('error', `Failed to open projector: ${e}`);
    } finally {
        btn.classList.remove('loading');
    }
}

// ── Tauri: Close projector ──
async function closeProjectorWindow() {
    try {
        await tauriInvoke('close_projector_window');
    } catch (e) {
        console.warn('Error closing projector:', e);
    }
    projectorOpen = false;
    updateOutputsButton(false);
    showProjectorToast('info', 'Projector screen closed');
}

// ── Update the outputs open-projector-btn ──
function updateOutputsButton(isOpen) {
    const btn = document.getElementById('open-projector-btn');
    if (!btn) return;
    const label = btn.querySelector('.btn-label');
    if (!label) return;
    if (isOpen) {
        label.innerHTML = '<svg viewBox="0 0 20 20" fill="currentColor" style="width:16px;height:16px"><path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"/></svg> Close Projector';
        btn.className = 'btn btn-danger';
    } else {
        label.innerHTML = 'Open Projector Screen';
        btn.className = 'btn btn-secondary';
    }
}

// ── Browser fallback: open via popup ──
async function openProjectorScreen() {
    if (projectorWindow) {
        await closeProjectorScreen();
        return;
    }

    const popup = window.open('/screen', 'ScriptureCast Projector',
        'width=1920,height=1080,left=0,top=0');
    if (!popup || popup.closed || typeof popup.closed === 'undefined') {
        showProjectorToast('error', 'Popup blocked. Please allow popups for this site to open the projector screen.');
        return;
    }
    projectorWindow = popup;
    updateBrowserButton(true);
    showProjectorToast('info', 'Drag the projector window to your HDMI screen and press F11 for fullscreen');

    if (projectorCheckInterval) clearInterval(projectorCheckInterval);
    projectorCheckInterval = setInterval(() => {
        if (projectorWindow && projectorWindow.closed) {
            projectorWindow = null;
            clearInterval(projectorCheckInterval);
            projectorCheckInterval = null;
            updateBrowserButton(false);
        }
    }, 1000);

    getDisplays().then(displays => {
        if (!projectorWindow || projectorWindow.closed) return;
        const secondary = displays.find(d => !d.is_primary) || displays[0] || {};
        const w = secondary.width || 1920;
        const h = secondary.height || 1080;
        const left = secondary.x || 0;
        const top = secondary.y || 0;
        try {
            projectorWindow.resizeTo(w, h);
            projectorWindow.moveTo(left, top);
        } catch { }
        if (secondary && !secondary.is_primary) {
            showProjectorToast('success', `Projector positioned on "${secondary.name || 'secondary display'}" (${w}x${h})`);
        }
    });
}

async function closeProjectorScreen() {
    if (projectorWindow && !projectorWindow.closed) {
        projectorWindow.close();
    }
    projectorWindow = null;
    if (projectorCheckInterval) {
        clearInterval(projectorCheckInterval);
        projectorCheckInterval = null;
    }
    updateBrowserButton(false);
    showProjectorToast('info', 'Projector screen closed');
}

function updateBrowserButton(isOpen) {
    const btn = document.getElementById('open-screen-btn');
    if (!btn) return;
    if (isOpen) {
        btn.innerHTML = '<svg viewBox="0 0 20 20" fill="currentColor"><path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"/></svg> Close Projector';
        btn.className = 'btn btn-danger';
    } else {
        btn.innerHTML = '<svg viewBox="0 0 20 20" fill="currentColor"><path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z"/><path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z"/></svg> Open Projector Screen';
        btn.className = 'btn btn-secondary';
    }
}

function showProjectorToast(type, message) {
    let toast = document.getElementById('projector-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'projector-toast';
        toast.innerHTML = '<span id="projector-toast-msg"></span><button id="projector-toast-close">&times;</button>';
        document.body.appendChild(toast);

        document.getElementById('projector-toast-close').addEventListener('click', () => {
            toast.classList.add('hidden');
        });
    }

    toast.className = '';
    if (type === 'error') toast.classList.add('error');
    else if (type === 'success') toast.classList.add('success');
    document.getElementById('projector-toast-msg').textContent = message;
    toast.classList.remove('hidden');

    if (toast._hideTimer) clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => {
        toast.classList.add('hidden');
    }, 4000);
}

// ── Event Listeners ──
// Browser fallback button
document.getElementById('open-screen-btn').addEventListener('click', openProjectorScreen);

// Tauri-specific outputs section
if (window.__TAURI__) {
    const outputsSection = document.getElementById('outputs-section');
    if (outputsSection) outputsSection.classList.remove('hidden');

    document.getElementById('refresh-displays-btn')?.addEventListener('click', loadDisplays);
    document.getElementById('identify-displays-btn')?.addEventListener('click', identifyDisplays);
    document.getElementById('open-projector-btn')?.addEventListener('click', async () => {
        if (projectorOpen) {
            await closeProjectorWindow();
        } else {
            await openProjectorOnDisplay();
        }
    });

    // Hide browser fallback in Tauri
    const previewActions = document.getElementById('preview-actions');
    if (previewActions) previewActions.classList.add('hidden');

    loadDisplays();
}

// ── Image Upload & Gallery ─────────────────────────────────
async function uploadImage(file) {
    imagesUploadLabel.textContent = 'Uploading…';
    imagesUploadLabel.style.opacity = '0.6';
    try {
        const formData = new FormData();
        formData.append('file', file);
        const resp = await fetch(`${BASE_URL}/api/upload-image`, { method: 'POST', body: formData });
        if (!resp.ok) throw new Error(`Upload failed: ${resp.statusText}`);
        const data = await resp.json();
        uploadedImages.unshift({ url: data.url, filename: data.filename });
        renderImageGallery();
    } catch (err) {
        appendStatusMessage(`Image upload error: ${err.message}`);
    } finally {
        imagesUploadLabel.textContent = 'Upload Image';
        imagesUploadLabel.style.opacity = '1';
    }
}

function renderImageGallery() {
    imagesGallery.innerHTML = '';
    if (uploadedImages.length === 0) {
        imagesGallery.innerHTML = '<p class="placeholder-text" style="padding:12px;text-align:center;font-size:12px;color:var(--text-muted);">No images uploaded yet</p>';
        return;
    }
    uploadedImages.forEach(img => {
        const item = document.createElement('div');
        item.className = 'image-gallery-item';
        item.innerHTML = `
            <img src="${escHtml(img.url)}" loading="lazy" class="image-thumb">
            <div class="image-actions">
                <button class="btn btn-primary btn-sm image-display-btn" data-url="${escHtml(img.url)}">
                    <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12"><path d="M2 6a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/></svg>
                    Display
                </button>
                <button class="btn btn-secondary btn-sm image-clear-btn" data-url="${escHtml(img.url)}">
                    <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
                    Clear
                </button>
            </div>
        `;
        item.querySelector('.image-display-btn').addEventListener('click', () => {
            send({ type: 'display_image', image_url: img.url });
            showProjectorToast('success', 'Image sent to projector');
        });
        item.querySelector('.image-clear-btn').addEventListener('click', () => {
            send({ type: 'clear_image' });
            showProjectorToast('info', 'Image cleared from projector');
        });
        imagesGallery.appendChild(item);
    });
}

async function loadUploadedImages() {
    try {
        const resp = await fetch(`${BASE_URL}/api/images`);
        if (!resp.ok) return;
        const data = await resp.json();
        uploadedImages = data.images || [];
        renderImageGallery();
    } catch { }
}

imagesFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        uploadImage(file);
        imagesFileInput.value = '';
    }
});

imagesUploadLabel.addEventListener('click', (e) => {
    e.preventDefault();
    imagesFileInput.click();
});

// ── Chapter Browser ─────────────────────────────────────────
let _browserBook = null;
let _browserChapter = null;
let _browserVerses = [];

async function _loadChapterVerses(book, chapter, activeVerse) {
  const bookData = B.find(b => b[0] === book);
  if (!bookData) return;
  const maxVerse = bookData[chapter];
  if (!maxVerse) return;

  const translation = translationSel.value;
  const url = `${BASE_URL}/api/verse?book=${encodeURIComponent(book)}&chapter=${chapter}&verse=1&verse_end=${maxVerse}&translation=${translation}`;
  try {
    const resp = await fetch(url);
    const data = await resp.json();
    if (data.verses) {
      _browserVerses = data.verses;
      _renderBrowser(book, chapter, activeVerse);
    }
  } catch {
    _browserVerses = [];
  }
}

function _renderBrowser(book, chapter, activeVerse) {
  const list = document.getElementById('chapter-verse-list');
  if (!list) return;
  list.innerHTML = '';

  for (const v of _browserVerses) {
    const row = document.createElement('div');
    row.className = 'ch-verse-row';
    if (v.verse === activeVerse) row.classList.add('active');
    row.dataset.verse = v.verse;

    const num = document.createElement('span');
    num.className = 'ch-verse-num';
    num.textContent = v.verse;

    const preview = document.createElement('span');
    preview.className = 'ch-verse-text';
    const txt = v.text.length > 60 ? v.text.slice(0, 60) + '…' : v.text;
    preview.textContent = txt;

    const btn = document.createElement('button');
    btn.className = 'ch-verse-display-btn';
    btn.innerHTML = '<svg viewBox="0 0 20 20" fill="currentColor"><path d="M2 6a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/></svg> Display';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ref = `${book} ${chapter}:${v.verse}`;
      if (socket && socket.readyState === WebSocket.OPEN) {
        send({ type: 'manual_verse', verse_text: ref });
      } else if (window.__TAURI_INTERNALS__) {
        doManualVerseLookup(ref);
      }
    });

    row.appendChild(num);
    row.appendChild(preview);
    row.appendChild(btn);
    list.appendChild(row);
  }

  const activeRow = list.querySelector('.ch-verse-row.active');
  if (activeRow) activeRow.scrollIntoView({ block: 'center' });
}

function _highlightCurrentVerseInBrowser(verse) {
  const rows = document.querySelectorAll('#chapter-verse-list .ch-verse-row');
  rows.forEach(row => row.classList.toggle('active', parseInt(row.dataset.verse) === verse));
  const activeRow = document.querySelector('#chapter-verse-list .ch-verse-row.active');
  if (activeRow) activeRow.scrollIntoView({ block: 'center' });
}

function updateChapterBrowser(scripture) {
  const card = document.getElementById('chapter-browser-card');
  if (!card) return;

  if (!scripture || !scripture.book || !scripture.chapter) {
    return;
  }

  const book = scripture.book;
  const chapter = scripture.chapter;
  const verseStart = scripture.verse_start;

  if (book === _browserBook && chapter === _browserChapter) {
    _highlightCurrentVerseInBrowser(verseStart);
    return;
  }

  _browserBook = book;
  _browserChapter = chapter;

  const title = document.getElementById('chapter-title');
  if (title) title.textContent = `${book} ${chapter}`;
  card.classList.remove('hidden');

  _loadChapterVerses(book, chapter, verseStart);
}

document.getElementById('ch-prev-btn')?.addEventListener('click', () => {
  if (!_browserBook || !_browserChapter || _browserChapter <= 1) return;
  const ref = `${_browserBook} ${_browserChapter - 1}:1`;
  if (socket && socket.readyState === WebSocket.OPEN) {
    send({ type: 'manual_verse', verse_text: ref });
  } else if (window.__TAURI_INTERNALS__) {
    doManualVerseLookup(ref);
  }
});

document.getElementById('ch-next-btn')?.addEventListener('click', () => {
  if (!_browserBook || !_browserChapter) return;
  const bookData = B.find(b => b[0] === _browserBook);
  if (!bookData || _browserChapter >= bookData.length - 1) return;
  const ref = `${_browserBook} ${_browserChapter + 1}:1`;
  if (socket && socket.readyState === WebSocket.OPEN) {
    send({ type: 'manual_verse', verse_text: ref });
  } else if (window.__TAURI_INTERNALS__) {
    doManualVerseLookup(ref);
  }
});

// ── Verse Autocomplete ──────────────────────────────────────
const B = [
  ["Genesis",31,25,24,26,32,22,24,22,29,32,32,20,18,24,21,16,27,33,38,18,34,24,20,67,34,35,46,22,35,43,55,32,20,31,29,43,36,30,23,23,57,38,34,34,28,34,31,22,33,33],
  ["Exodus",22,25,22,31,23,30,25,32,35,29,10,51,22,31,27,36,16,27,25,26,36,31,33,18,40,37,21,43,46,38,18,35,23,35,35,38,29,31,43,38],
  ["Leviticus",17,16,17,35,19,30,38,36,24,20,47,8,59,57,33,34,16,30,37,27,24,33,44,23,55,46,34],
  ["Numbers",54,34,51,49,31,27,89,26,23,36,35,16,33,45,41,50,13,32,22,29,35,41,30,25,18,65,23,31,40,16,54,42,56,29,34,13],
  ["Deuteronomy",46,37,29,49,33,25,26,20,29,22,32,32,18,29,23,22,20,22,21,20,23,30,25,22,19,19,26,68,29,20,30,52,29,12],
  ["Joshua",18,24,17,24,15,27,26,35,27,43,23,24,33,15,63,10,18,28,51,9,45,34,16,33],
  ["Judges",36,23,31,24,31,40,25,35,57,18,40,15,25,20,20,31,13,31,30,48,25],
  ["Ruth",22,23,18,22],
  ["1 Samuel",28,36,21,22,12,21,17,22,27,27,15,25,23,52,35,23,58,30,24,42,15,23,29,22,44,25,12,25,11,31,13],
  ["2 Samuel",27,32,39,12,25,23,29,18,13,19,27,31,39,33,37,23,29,33,43,26,22,51,39,25],
  ["1 Kings",53,46,28,34,18,38,51,66,28,29,43,33,34,31,34,34,24,46,21,43,29,53],
  ["2 Kings",18,25,27,44,27,33,20,29,37,36,21,21,25,29,38,20,41,37,37,21,26,20,37,20,30],
  ["1 Chronicles",54,55,24,43,26,81,40,40,44,14,47,40,14,17,29,43,27,17,19,8,30,19,32,31,31,32,34,21,30],
  ["2 Chronicles",17,18,17,22,14,42,22,18,31,19,23,16,22,15,19,14,19,34,11,37,20,12,21,27,28,23,9,27,36,27,21,33,25,33,27,23],
  ["Ezra",11,70,13,24,17,22,28,36,15,44],
  ["Nehemiah",11,20,32,23,19,19,73,18,38,39,36,47,31],
  ["Esther",22,23,15,17,14,14,10,17,32,3],
  ["Job",22,13,26,21,27,30,21,22,35,22,20,25,28,22,35,22,16,21,29,29,34,30,17,25,6,14,23,28,25,31,40,22,33,37,16,33,24,41,30,24,34,17],
  ["Psalms",6,12,8,8,12,10,17,9,20,18,7,8,6,7,5,11,15,50,14,9,13,31,6,10,22,12,14,9,11,12,24,11,22,22,28,12,40,22,13,17,13,11,5,26,17,11,9,14,20,23,19,9,6,7,23,13,11,17,12,8,12,11,10,13,20,7,35,36,5,24,20,28,23,10,12,20,72,13,19,16,8,18,12,13,17,7,18,52,17,16,15,5,23,11,13,12,9,9,5,8,28,22,35,45,48,43,13,31,7,10,28,10,9,8,18,19,2,29,176,7,8,9,4,8,5,6,5,6,8,8,3,18,3,3,21,26,9,8,24,13,10,7,12,15,21,10,20,14,9,6],
  ["Proverbs",33,22,35,27,23,35,27,36,18,32,31,28,25,35,33,33,28,24,29,30,31,29,35,34,28,28,27,28,27,33,31],
  ["Ecclesiastes",18,26,22,16,20,12,29,17,18,20,10,14],
  ["Song of Solomon",17,17,11,16,16,13,13,14],
  ["Isaiah",31,22,26,6,30,13,25,22,21,34,16,6,22,32,9,14,14,7,25,6,17,25,18,23,12,21,13,29,24,33,9,20,24,17,10,22,38,22,8,31,29,25,28,28,25,13,15,22,26,11,23,15,12,17,13,12,21,14,21,22,11,12,19,12,25,24],
  ["Jeremiah",19,37,25,31,31,30,34,22,26,25,23,17,27,22,21,21,27,23,15,18,14,30,40,10,38,24,22,17,32,24,40,44,26,22,19,32,21,28,18,16,18,22,13,30,5,28,7,47,39,46,64,34],
  ["Lamentations",22,22,66,22,22],
  ["Ezekiel",28,10,27,17,17,14,27,18,11,22,25,28,23,23,8,63,24,32,14,49,32,31,49,27,17,21,36,26,21,26,18,32,33,31,15,38,28,23,29,49,26,20,27,31,25,24,23,35],
  ["Daniel",21,49,30,37,31,28,28,27,27,21,45,13],
  ["Hosea",11,23,5,19,15,11,16,14,17,15,12,14,16,9],
  ["Joel",20,32,21],
  ["Amos",15,16,15,13,27,14,17,14,15],
  ["Obadiah",21],
  ["Jonah",17,10,10,11],
  ["Micah",16,13,12,14,15,16,20],
  ["Nahum",15,13,19],
  ["Habakkuk",17,20,19],
  ["Zephaniah",18,15,20],
  ["Haggai",15,23],
  ["Zechariah",21,13,10,14,11,15,14,23,17,12,17,14,9,21],
  ["Malachi",14,17,18,6],
  ["Matthew",25,23,17,25,48,34,29,34,38,42,30,50,58,36,39,28,27,35,30,34,46,46,39,51,46,75,66,20],
  ["Mark",45,28,35,41,43,56,37,38,50,52,33,44,37,72,47,20],
  ["Luke",80,52,38,44,39,49,50,56,62,42,54,59,35,35,32,31,37,43,48,47,38,71,56,53],
  ["John",51,25,36,54,47,71,53,59,41,42,57,50,38,31,27,33,26,40,42,31,25],
  ["Acts",26,47,26,37,42,15,60,40,43,48,30,25,52,28,41,40,34,28,41,38,40,30,35,27,27,32,44,31],
  ["Romans",32,29,31,25,21,23,25,39,33,21,36,21,14,23,33,27],
  ["1 Corinthians",31,16,23,21,13,20,40,13,27,33,34,31,13,40,58,24],
  ["2 Corinthians",24,17,18,18,21,18,16,24,15,18,33,21,14],
  ["Galatians",24,21,29,31,26,18],
  ["Ephesians",23,22,21,32,33,24],
  ["Philippians",30,30,21,23],
  ["Colossians",29,23,25,18],
  ["1 Thessalonians",10,20,13,18,28],
  ["2 Thessalonians",12,17,18],
  ["1 Timothy",20,15,16,16,25,21],
  ["2 Timothy",18,26,17,22],
  ["Titus",16,15,15],
  ["Philemon",25],
  ["Hebrews",14,18,19,16,14,20,28,13,28,39,40,29,25],
  ["James",27,26,18,17,20],
  ["1 Peter",25,25,22,19,14],
  ["2 Peter",21,22,18],
  ["1 John",10,29,24,21,21],
  ["2 John",13],
  ["3 John",15],
  ["Jude",25],
  ["Revelation",20,29,22,11,14,17,17,13,21,11,19,18,18,20,8,21,18,24,21,15,27,21]
];

const WELL_KNOWN_VERSES = [
  { ref: "John 3:16", book: "John", ch: 3, v: 16 },
  { ref: "Psalm 23:1", book: "Psalms", ch: 23, v: 1 },
  { ref: "Romans 8:28", book: "Romans", ch: 8, v: 28 },
  { ref: "Philippians 4:13", book: "Philippians", ch: 4, v: 13 },
  { ref: "Genesis 1:1", book: "Genesis", ch: 1, v: 1 },
  { ref: "Psalm 119:105", book: "Psalms", ch: 119, v: 105 },
  { ref: "Proverbs 3:5", book: "Proverbs", ch: 3, v: 5 },
  { ref: "Jeremiah 29:11", book: "Jeremiah", ch: 29, v: 11 },
  { ref: "Romans 8:31", book: "Romans", ch: 8, v: 31 },
  { ref: "Psalm 23:4", book: "Psalms", ch: 23, v: 4 },
  { ref: "2 Corinthians 5:17", book: "2 Corinthians", ch: 5, v: 17 },
  { ref: "Ephesians 2:8", book: "Ephesians", ch: 2, v: 8 },
  { ref: "Matthew 28:19", book: "Matthew", ch: 28, v: 19 },
  { ref: "Romans 12:2", book: "Romans", ch: 12, v: 2 },
  { ref: "Joshua 1:9", book: "Joshua", ch: 1, v: 9 },
];

const BOOK_ABBREVIATIONS = {
  "gen": "Genesis", "ge": "Genesis", "gn": "Genesis",
  "exo": "Exodus", "exod": "Exodus",
  "lev": "Leviticus",
  "num": "Numbers", "nm": "Numbers", "nbr": "Numbers",
  "deut": "Deuteronomy", "dt": "Deuteronomy",
  "josh": "Joshua", "jos": "Joshua",
  "judg": "Judges", "jg": "Judges", "jdg": "Judges",
  "rut": "Ruth",
  "1sa": "1 Samuel", "1s": "1 Samuel", "1 sam": "1 Samuel",
  "2sa": "2 Samuel", "2s": "2 Samuel", "2 sam": "2 Samuel",
  "1ki": "1 Kings", "1k": "1 Kings", "1 ki": "1 Kings",
  "2ki": "2 Kings", "2k": "2 Kings", "2 ki": "2 Kings",
  "1ch": "1 Chronicles", "1 chron": "1 Chronicles",
  "2ch": "2 Chronicles", "2 chron": "2 Chronicles",
  "ezr": "Ezra",
  "neh": "Nehemiah",
  "esth": "Esther", "est": "Esther",
  "psa": "Psalms", "ps": "Psalms", "pss": "Psalms", "psalm": "Psalms",
  "prov": "Proverbs", "prv": "Proverbs",
  "ecc": "Ecclesiastes", "eccles": "Ecclesiastes",
  "song": "Song of Solomon", "sos": "Song of Solomon",
  "isa": "Isaiah",
  "jer": "Jeremiah", "jrm": "Jeremiah",
  "lam": "Lamentations",
  "ezek": "Ezekiel", "ezk": "Ezekiel",
  "dan": "Daniel", "dn": "Daniel",
  "hos": "Hosea",
  "jl": "Joel",
  "amo": "Amos",
  "obad": "Obadiah",
  "jon": "Jonah", "jnh": "Jonah",
  "mic": "Micah",
  "nah": "Nahum",
  "hab": "Habakkuk",
  "zeph": "Zephaniah", "zep": "Zephaniah",
  "hag": "Haggai",
  "zech": "Zechariah", "zec": "Zechariah",
  "mal": "Malachi",
  "matt": "Matthew", "mat": "Matthew", "mt": "Matthew",
  "mar": "Mark", "mk": "Mark", "mrk": "Mark",
  "luk": "Luke", "lk": "Luke",
  "joh": "John", "jn": "John", "jhn": "John",
  "rom": "Romans", "rm": "Romans",
  "1co": "1 Corinthians", "1c": "1 Corinthians", "1 cor": "1 Corinthians",
  "2co": "2 Corinthians", "2c": "2 Corinthians", "2 cor": "2 Corinthians",
  "gal": "Galatians", "ga": "Galatians",
  "eph": "Ephesians", "ephes": "Ephesians",
  "phil": "Philippians", "php": "Philippians",
  "col": "Colossians",
  "1th": "1 Thessalonians", "1t": "1 Thessalonians", "1 thess": "1 Thessalonians",
  "2th": "2 Thessalonians", "2t": "2 Thessalonians", "2 thess": "2 Thessalonians",
  "1ti": "1 Timothy", "1 tim": "1 Timothy",
  "2ti": "2 Timothy", "2 tim": "2 Timothy",
  "tit": "Titus",
  "phm": "Philemon", "philem": "Philemon",
  "heb": "Hebrews", "hebr": "Hebrews",
  "jas": "James",
  "1pe": "1 Peter", "1p": "1 Peter", "1 pet": "1 Peter",
  "2pe": "2 Peter", "2p": "2 Peter", "2 pet": "2 Peter",
  "1j": "1 John", "1 jn": "1 John",
  "2j": "2 John", "2 jn": "2 John",
  "3j": "3 John", "3 jn": "3 John",
  "jud": "Jude",
  "rev": "Revelation", "revel": "Revelation"
};

let _suggestionIndex = -1;

function _findBook(input) {
  const lower = input.toLowerCase().replace(/\s+/g, ' ').trim();
  const numbered = /^\d+/.test(lower);

  const fullName = BOOK_ABBREVIATIONS[lower];
  if (fullName) return B.find(b => b[0] === fullName) || null;

  for (const book of B) {
    const name = book[0].toLowerCase();
    if (name === lower) return book;
    if (name.startsWith(lower)) return book;
  }
  if (!numbered) {
    for (const book of B) {
      const name = book[0].toLowerCase();
      if (name.includes(lower)) return book;
    }
  }
  return null;
}

function _findBooksPartial(input) {
  const lower = input.toLowerCase().replace(/\s+/g, ' ').trim();
  const results = [];
  const numbered = /^\d+/.test(lower);

  const fullName = BOOK_ABBREVIATIONS[lower];
  if (fullName) {
    const book = B.find(b => b[0] === fullName);
    if (book) results.unshift(book);
    return results;
  }

  for (const book of B) {
    const name = book[0].toLowerCase();
    if (name === lower) { results.unshift(book); continue; }
    if (name.startsWith(lower)) { results.push(book); continue; }
    if (!numbered && name.includes(lower)) results.push(book);
  }
  return results;
}

function _getSuggestions(input) {
  const trimmed = input.trim();
  if (trimmed.length < 2) return [];

  const parts = trimmed.split(/\s+/);
  let matchedBook = null;
  let chapStr = null;
  let verseStr = null;
  let afterBook = '';

  for (let i = Math.min(parts.length, 3); i >= 1; i--) {
    const candidate = parts.slice(0, i).join(' ');
    const book = _findBook(candidate);
    if (book) {
      matchedBook = book;
      afterBook = parts.slice(i).join(' ').trim();
      break;
    }
  }

  const results = [];

  if (!matchedBook) {
    const partials = _findBooksPartial(trimmed);
    for (const b of partials.slice(0, 6)) {
      results.push({ label: b[0], type: 'book', book: b[0] });
    }
    return results;
  }

  const cvMatch = afterBook.match(/^(\d+)(?::(\d*))?$/);
  if (cvMatch) {
    chapStr = cvMatch[1];
    verseStr = cvMatch[2] !== undefined ? cvMatch[2] : null;
  }

  const ch = chapStr ? parseInt(chapStr) : null;
  const v = verseStr && verseStr !== '' ? parseInt(verseStr) : (verseStr === '' ? 0 : null);

  if (ch !== null && ch >= 1 && ch <= matchedBook.length - 1) {
    const maxV = matchedBook[ch];
    const bookName = matchedBook[0];

    if (v !== null && v >= 1 && v <= maxV) {
      const ref = `${bookName} ${ch}:${v}`;
      const wk = WELL_KNOWN_VERSES.find(w => w.ref === ref);
      if (wk) results.push({ label: ref, type: 'verse', book: bookName, ch, v, wellKnown: true });
      results.push({ label: ref, type: 'verse', book: bookName, ch, v });
    } else if (v === 0) {
      const start = 1;
      const end = Math.min(maxV, start + 7);
      for (let vi = start; vi <= end; vi++) {
        const ref = `${bookName} ${ch}:${vi}`;
        const wk = WELL_KNOWN_VERSES.find(w => w.ref === ref);
        results.push({ label: ref, type: 'verse', book: bookName, ch, v: vi, wellKnown: !!wk });
      }
      if (end < maxV) results.push({ label: `${bookName} ${ch}:${end + 1}–${maxV}`, type: 'range', book: bookName, ch, v: end + 1 });
    } else {
      const start = 1;
      const end = Math.min(maxV, start + 7);
      for (let vi = start; vi <= end; vi++) {
        const ref = `${bookName} ${ch}:${vi}`;
        const wk = WELL_KNOWN_VERSES.find(w => w.ref === ref);
        results.push({ label: ref, type: 'verse', book: bookName, ch, v: vi, wellKnown: !!wk });
      }
      if (end < maxV) results.push({ label: `${bookName} ${ch}:${end + 1}–${maxV}`, type: 'range', book: bookName, ch, v: end + 1 });
    }
  } else if (ch !== null && ch >= 1) {
    const bookName = matchedBook[0];
    results.push({ label: `${bookName} ${ch}`, type: 'chapter', book: bookName, ch });
  } else {
    const bookName = matchedBook[0];
    results.push({ label: bookName, type: 'book', book: bookName });
    const maxCh = matchedBook.length - 1;
    const startCh = 1;
    const endCh = Math.min(maxCh, startCh + 6);
    for (let ci = startCh; ci <= endCh; ci++) {
      const maxV = matchedBook[ci];
      results.push({ label: `${bookName} ${ci}:1`, type: 'verse', book: bookName, ch: ci, v: 1 });
    }
    if (endCh < maxCh) results.push({ label: `${bookName} ${endCh + 1}–${maxCh}`, type: 'range', book: bookName, ch: endCh + 1 });
  }

  const wkBoosted = [];
  const normal = [];
  for (const r of results) {
    if (r.wellKnown) wkBoosted.push(r);
    else normal.push(r);
  }
  const sorted = [...wkBoosted, ...normal];

  return sorted.slice(0, 8);
}

function _renderSuggestions(items) {
  const existing = document.getElementById('suggestion-dropdown');
  if (existing) existing.remove();
  _suggestionIndex = -1;

  if (!items || items.length === 0) return;

  const dropdown = document.createElement('div');
  dropdown.id = 'suggestion-dropdown';
  dropdown.setAttribute('role', 'listbox');
  dropdown.setAttribute('aria-label', 'Verse suggestions');

  items.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'suggestion-row';
    row.setAttribute('role', 'option');
    row.setAttribute('tabindex', '-1');
    row.dataset.index = idx;

    const labelSpan = document.createElement('span');
    labelSpan.className = 'suggestion-label';
    labelSpan.textContent = item.label;

    row.appendChild(labelSpan);

    if (item.type === 'book') {
      const badge = document.createElement('span');
      badge.className = 'suggestion-badge suggestion-badge-book';
      badge.textContent = 'Book';
      row.appendChild(badge);
    } else if (item.type === 'range') {
      const badge = document.createElement('span');
      badge.className = 'suggestion-badge suggestion-badge-range';
      badge.textContent = 'More…';
      row.appendChild(badge);
    } else if (item.wellKnown) {
      const badge = document.createElement('span');
      badge.className = 'suggestion-badge suggestion-badge-popular';
      badge.textContent = 'Popular';
      row.appendChild(badge);
    }

    row.addEventListener('mousedown', (e) => {
      e.preventDefault();
      _selectSuggestion(item);
    });
    row.addEventListener('mouseenter', () => {
      _suggestionIndex = idx;
      _highlightSuggestion();
    });

    dropdown.appendChild(row);
  });

  document.getElementById('manual-lookup-form').appendChild(dropdown);
  _suggestionIndex = 0;
  _highlightSuggestion();
}

function _selectSuggestion(item) {
  if (item.type === 'range') {
    manualInput.value = `${item.book} ${item.ch}:${item.v}`;
    manualLookupBtn.click();
    return;
  }
  if (item.type === 'book') {
    manualInput.value = item.book + ' ';
    manualInput.focus();
    _suggestionIndex = -1;
    const ev = new Event('input');
    manualInput.dispatchEvent(ev);
    return;
  }
  manualInput.value = item.label;
  const dropdown = document.getElementById('suggestion-dropdown');
  if (dropdown) dropdown.remove();
  _suggestionIndex = -1;
  manualLookupBtn.click();
}

function _closeSuggestions() {
  const dropdown = document.getElementById('suggestion-dropdown');
  if (dropdown) dropdown.remove();
  _suggestionIndex = -1;
}

function _onSuggestionInput() {
  const val = manualInput.value;
  if (val.length < 2) { _closeSuggestions(); return; }
  const items = _getSuggestions(val);
  _renderSuggestions(items);
}

function _onSuggestionKeydown(e) {
  const dropdown = document.getElementById('suggestion-dropdown');
  if (!dropdown) return;
  const items = dropdown.querySelectorAll('.suggestion-row');
  if (!items.length) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    _suggestionIndex = Math.min(_suggestionIndex + 1, items.length - 1);
    _highlightSuggestion();
    const active = items[_suggestionIndex];
    if (active) active.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    _suggestionIndex = Math.max(_suggestionIndex - 1, 0);
    _highlightSuggestion();
    const active = items[_suggestionIndex];
    if (active) active.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const suggestions = _getSuggestions(manualInput.value);
    if (_suggestionIndex >= 0 && _suggestionIndex < suggestions.length) {
      _selectSuggestion(suggestions[_suggestionIndex]);
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    _closeSuggestions();
  }
}

function _highlightSuggestion() {
  const rows = document.querySelectorAll('#suggestion-dropdown .suggestion-row');
  rows.forEach((row, idx) => {
    row.classList.toggle('highlighted', idx === _suggestionIndex);
  });
}

manualInput.addEventListener('input', _onSuggestionInput);
manualInput.addEventListener('keydown', _onSuggestionKeydown);
manualInput.addEventListener('blur', () => {
  setTimeout(_closeSuggestions, 200);
});

startDisplayWatch();
loadUploadedImages();

// ── Boot ───────────────────────────────────────────────────
connect();
initContinuousNote();
initSpeechRecognition();

if (!!(window.__TAURI_INTERNALS__)) {
    checkWhisperStatus().then(status => {
        if (status?.available) {
            micToggleBtn.title = 'Click to start recording (Local Whisper)';
        } else if (status?.sidecar_exists && !status?.model_exists) {
            micToggleBtn.title = 'Model missing — click to download';
            // One-click download on mic press
            const origToggle = toggleRecording;
            const dlHandler = async () => {
                micToggleBtn.removeEventListener('click', dlHandler);
                micToggleBtn.addEventListener('click', origToggle);
                await downloadWhisperModel();
            };
            micToggleBtn.removeEventListener('click', toggleRecording);
            micToggleBtn.addEventListener('click', dlHandler);
        }
    });
} else if (hasSpeechSupport()) {
    micToggleBtn.title = 'Click to start live sermon transcription (AssemblyAI)';
}

// Prevent back/forward navigation from leaving the app
window.addEventListener('popstate', (e) => {
    history.pushState(null, '', location.href);
});
history.pushState(null, '', location.href);
