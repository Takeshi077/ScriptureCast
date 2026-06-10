const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${wsProtocol}//${window.location.host}/ws`;

const container = document.getElementById('display-container');
const referenceEl = document.getElementById('reference');
const textEl = document.getElementById('scripture-text');
const idleContainer = document.getElementById('idle-container');
const idleImage = document.getElementById('idle-image');

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
            updateDisplay(msg.active_scripture, msg.display_duration);
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

function showIdle(activeScripture) {
    container.classList.remove('visible');
    container.classList.add('hidden');

    if (activeScripture.mode === 'image' && activeScripture.image_url) {
        idleImage.src = activeScripture.image_url;
        idleContainer.classList.remove('hidden');
        requestAnimationFrame(() => {
            idleContainer.classList.add('visible');
        });
    } else {
        idleContainer.classList.remove('visible');
        idleContainer.classList.add('hidden');
    }
}

function hideAll() {
    container.classList.remove('visible');
    container.classList.add('hidden');
    idleContainer.classList.remove('visible');
    idleContainer.classList.add('hidden');
}

function updateDisplay(activeScripture, durationSeconds) {
    if (displayTimeout) {
        clearTimeout(displayTimeout);
        displayTimeout = null;
    }

    if (!activeScripture) {
        hideAll();
        return;
    }

    // Idle content (between verses)
    if (activeScripture._idle) {
        showIdle(activeScripture);
        return;
    }

    // Normal scripture display
    idleContainer.classList.remove('visible');
    idleContainer.classList.add('hidden');

    if (activeScripture.text) {
        referenceEl.textContent = activeScripture.reference || '';
        textEl.textContent = `"${activeScripture.text}"`;
        textEl.scrollTop = 0;

        container.classList.remove('hidden');
        requestAnimationFrame(() => {
            container.classList.add('visible');
        });

        if (durationSeconds && durationSeconds > 0) {
            displayTimeout = setTimeout(() => {
                hideDisplay();
            }, durationSeconds * 1000);
        }
    } else {
        hideDisplay();
    }
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
