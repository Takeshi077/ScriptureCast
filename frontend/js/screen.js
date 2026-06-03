// Establish WebSocket connection
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
let socket;

const container = document.getElementById('display-container');
const referenceEl = document.getElementById('reference');
const textEl = document.getElementById('scripture-text');

let displayTimeout = null;

function connect() {
    socket = new WebSocket(wsUrl);
    
    socket.onopen = () => {
        console.log('Display Screen connected to WebSocket server');
    };
    
    socket.onmessage = (event) => {
        const msg = jsonParse(event.data);
        if (msg && msg.type === 'state') {
            updateDisplay(msg.active_scripture, msg.display_duration);
        }
    };
    
    socket.onclose = () => {
        console.log('WebSocket connection closed. Reconnecting in 3 seconds...');
        setTimeout(connect, 3000);
    };
    
    socket.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

function updateDisplay(activeScripture, durationSeconds) {
    // Clear any existing fade-out timer
    if (displayTimeout) {
        clearTimeout(displayTimeout);
        displayTimeout = null;
    }
    
    if (activeScripture) {
        // Show scripture
        referenceEl.textContent = activeScripture.reference;
        textEl.textContent = `"${activeScripture.text}"`;
        
        container.classList.remove('hidden');
        // Small delay to trigger transition
        setTimeout(() => {
            container.classList.add('visible');
        }, 50);
        
        // Auto-clear duration countdown
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
    // Hide completely after fade transition completes (800ms in CSS)
    setTimeout(() => {
        if (!container.classList.contains('visible')) {
            container.classList.add('hidden');
        }
    }, 800);
}

function jsonParse(str) {
    try {
        return JSON.parse(str);
    } catch (e) {
        return null;
    }
}

// Start connection
connect();
