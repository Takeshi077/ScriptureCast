const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${wsProtocol}//${window.location.host}/ws`;

const container = document.getElementById('display-container');
const referenceEl = document.getElementById('reference');
const textEl = document.getElementById('scripture-text');

let socket = null;
let displayTimeout = null;
let _reconnectTimer = null;
let _lastState = null;

function connect() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        return;
    }

    socket = new WebSocket(WS_URL);

    socket.onopen = () => {
        console.log('Screen connected to WebSocket server');
    };

    socket.onmessage = (event) => {
        const msg = safeJson(event.data);
        if (!msg) return;

        if (msg.type === 'state') {
            _lastState = msg;
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

function updateDisplay(activeScripture) {
    if (displayTimeout) {
        clearTimeout(displayTimeout);
        displayTimeout = null;
    }

    if (!activeScripture) {
        container.classList.remove('visible');
        container.classList.add('hidden');
        return;
    }

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
    textEl.scrollTop = 0;

    container.classList.remove('hidden');
    requestAnimationFrame(() => {
        container.classList.add('visible');
    });
}

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
