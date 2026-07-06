const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

const WS_URL = !!(window.__TAURI_INTERNALS__)
    ? 'wss://scripturecast.onrender.com/ws'
    : `${wsProtocol}//${window.location.host}/ws`;

const container = document.getElementById('display-container');
const referenceEl = document.getElementById('reference');
const textEl = document.getElementById('scripture-text');
const imageEl = document.getElementById('screen-image');
const navEl = document.getElementById('screen-navigation');
const prevBtn = document.getElementById('screen-prev-btn');
const nextBtn = document.getElementById('screen-next-btn');
const versePosEl = document.getElementById('screen-verse-position');

let socket = null;
let displayTimeout = null;
let _reconnectTimer = null;
let _lastState = null;
let currentVerseIndex = 0;
let _activeScripture = null;

// ── Tauri offline event listener ──────────────────────────
if (!!(window.__TAURI_INTERNALS__)) {
    try {
        window.__TAURI__.event.listen('verse-update', (event) => {
            const data = event.payload;
            if (data && data.active_scripture) {
                updateDisplay(data.active_scripture, data.active_image || null);
                currentVerseIndex = data.current_verse_index || 0;
            }
        });
    } catch (e) {
        console.log('Tauri event listen failed:', e);
    }
}

function send(obj) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(obj));
    }
}

async function getToken() {
    const local = localStorage.getItem('token');
    if (local) return local;

    const cookie = document.cookie.split(';').find(c => c.trim().startsWith('access_token='))?.split('=')[1];
    if (cookie) return cookie;

    if (!!(window.__TAURI_INTERNALS__)) {
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

    let token;
    try {
        token = await getToken();
    } catch {
        token = null;
    }
    const urlWithToken = token ? `${WS_URL}?token=${encodeURIComponent(token)}` : WS_URL;
    socket = new WebSocket(urlWithToken);

    socket.onopen = () => {
        console.log('Screen connected to WebSocket server');
    };

    socket.onmessage = (event) => {
        const msg = safeJson(event.data);
        if (!msg) return;

        if (msg.type === 'state') {
            _lastState = msg;
            currentVerseIndex = msg.current_verse_index ?? 0;
            _activeScripture = msg.active_scripture;
            updateDisplay(msg.active_scripture, msg.active_image);
        }
    };

    socket.onclose = () => {
        if (displayTimeout) {
            clearTimeout(displayTimeout);
            displayTimeout = null;
        }
        if (_reconnectTimer) clearTimeout(_reconnectTimer);
        _reconnectTimer = setTimeout(connect, 2000);
    };

    socket.onerror = () => {
        // onclose will handle reconnect
    };
}

function renderSingleVerse(verse, book, chapter) {
    referenceEl.textContent = `${book} ${chapter}:${verse.verse}`;

    textEl.innerHTML = '';
    const verseDiv = document.createElement('div');
    verseDiv.className = 'verse-block';
    const numSup = document.createElement('sup');
    numSup.className = 'verse-num';
    numSup.textContent = verse.verse;
    const textSpan = document.createElement('span');
    textSpan.className = 'verse-text';
    textSpan.textContent = verse.text;
    verseDiv.appendChild(numSup);
    verseDiv.appendChild(document.createTextNode(' '));
    verseDiv.appendChild(textSpan);
    textEl.appendChild(verseDiv);
}

function renderAllVerses(activeScripture) {
    referenceEl.textContent = activeScripture.reference || '';
    textEl.innerHTML = '';
    if (activeScripture.verses && activeScripture.verses.length > 0) {
        activeScripture.verses.forEach(v => {
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
            textEl.appendChild(verseDiv);
        });
    } else {
        const verseDiv = document.createElement('div');
        verseDiv.className = 'verse-block';
        const textSpan = document.createElement('span');
        textSpan.className = 'verse-text';
        textSpan.textContent = activeScripture.text;
        verseDiv.appendChild(textSpan);
        textEl.appendChild(verseDiv);
    }
}

function updateNavigation(versesLength) {
    if (!versesLength || versesLength <= 1) {
        navEl.classList.add('hidden');
        return;
    }
    navEl.classList.remove('hidden');
    versePosEl.textContent = `Verse ${currentVerseIndex + 1} of ${versesLength}`;
    prevBtn.disabled = currentVerseIndex === 0;
    nextBtn.disabled = currentVerseIndex === versesLength - 1;
}

function updateDisplay(activeScripture, activeImage) {
    if (displayTimeout) {
        clearTimeout(displayTimeout);
        displayTimeout = null;
    }

    // Image display takes priority only when no active scripture
    if (activeImage && !activeScripture) {
        imageEl.src = activeImage;
        referenceEl.style.display = 'none';
        textEl.style.display = 'none';
        navEl.classList.add('hidden');
        container.classList.remove('hidden');
        requestAnimationFrame(() => {
            imageEl.classList.add('visible');
            container.classList.add('visible');
        });
        _activeScripture = null;
        return;
    }

    // Hide image with fade when scripture is showing
    imageEl.classList.remove('visible');
    referenceEl.style.display = '';
    textEl.style.display = '';

    if (!activeScripture) {
        imageEl.classList.remove('visible');
        imageEl.src = '';
        container.classList.remove('visible');
        container.classList.add('hidden');
        navEl.classList.add('hidden');
        _activeScripture = null;
        return;
    }

    // Clamp currentVerseIndex
    const verses = activeScripture.verses;
    const hasMultiple = verses && verses.length > 1;
    if (hasMultiple && currentVerseIndex >= verses.length) {
        currentVerseIndex = 0;
    }

    _activeScripture = activeScripture;

    if (hasMultiple) {
        renderSingleVerse(verses[currentVerseIndex], activeScripture.book, activeScripture.chapter);
        updateNavigation(verses.length);
    } else {
        renderAllVerses(activeScripture);
        navEl.classList.add('hidden');
    }

    textEl.scrollTop = 0;
    container.classList.remove('hidden');
    requestAnimationFrame(() => {
        container.classList.add('visible');
    });
}

function goToPrevVerse() {
    const verses = _activeScripture?.verses;
    if (!verses || verses.length <= 1 || currentVerseIndex <= 0) return;
    currentVerseIndex--;
    send({ type: 'verse_navigate', verse_index: currentVerseIndex });
    renderSingleVerse(verses[currentVerseIndex], _activeScripture.book, _activeScripture.chapter);
    updateNavigation(verses.length);
    textEl.scrollTop = 0;
}

function goToNextVerse() {
    const verses = _activeScripture?.verses;
    if (!verses || verses.length <= 1 || currentVerseIndex >= verses.length - 1) return;
    currentVerseIndex++;
    send({ type: 'verse_navigate', verse_index: currentVerseIndex });
    renderSingleVerse(verses[currentVerseIndex], _activeScripture.book, _activeScripture.chapter);
    updateNavigation(verses.length);
    textEl.scrollTop = 0;
}

prevBtn.addEventListener('click', goToPrevVerse);
nextBtn.addEventListener('click', goToNextVerse);

document.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'ArrowLeft') { goToPrevVerse(); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { goToNextVerse(); e.preventDefault(); }
});

function hideDisplay() {
    container.classList.remove('visible');
    setTimeout(() => {
        if (!container.classList.contains('visible')) {
            container.classList.add('hidden');
            referenceEl.textContent = '';
            textEl.textContent = '';
        }
    }, 700);
}

function safeJson(str) {
    try { return JSON.parse(str); } catch { return null; }
}

connect();

// Prevent back/forward navigation from leaving the screen
window.addEventListener('popstate', (e) => {
    history.pushState(null, '', location.href);
});
history.pushState(null, '', location.href);
