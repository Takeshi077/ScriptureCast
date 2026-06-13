const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const isTauri = window.__TAURI__ !== undefined;
const WS_URL = isTauri
    ? 'wss://scripturecast.onrender.com/ws'
    : `${wsProtocol}//${window.location.host}/ws`;

const container = document.getElementById('display-container');
const referenceEl = document.getElementById('reference');
const textEl = document.getElementById('scripture-text');
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
let _prevScriptureRef = null;

function send(obj) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(obj));
    }
}

function connect() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        return;
    }

    const token = localStorage.getItem('token');
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
            updateDisplay(msg.active_scripture);
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

function updateDisplay(activeScripture) {
    if (displayTimeout) {
        clearTimeout(displayTimeout);
        displayTimeout = null;
    }

    if (!activeScripture) {
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
