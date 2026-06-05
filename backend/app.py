from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse
import asyncio
import json
import os
import time
from contextlib import asynccontextmanager
from .parser import parse_text_for_verses
from .database import get_scripture
from .transcriber import init_model, start_transcribing, stop_transcribing
from .semantic import ensure_embeddings, search_similar_verses, might_be_quote

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Load ASR model, semantic embeddings, then start transcription
    init_model()
    ensure_embeddings()
    loop = asyncio.get_running_loop()
    def handle_transcription(text):
        asyncio.run_coroutine_threadsafe(process_transcript(text, is_final=True), loop)

    start_transcribing(handle_transcription)

    # Start continuous quote detection background loop
    detection_task = asyncio.create_task(_quote_detection_loop())

    yield
    # Shutdown: Stop transcription and cancel detection loop
    detection_task.cancel()
    stop_transcribing()

app = FastAPI(lifespan=lifespan)

# Global State
state = {
    "current_translation": "KJV",
    "display_duration": 15,
    "active_scripture": None,  # Will hold {"reference": "...", "text": "...", "book": "...", "chapter": N, "verse_start": N, "verse_end": N} or None
    "recent_transcripts": [],   # List of {"text": "...", "is_final": bool}
    "context_book": None,       # Last displayed book (for QV-07 context awareness)
    "context_chapter": None,    # Last displayed chapter
    "rolling_buffer": [],       # List of {"text": str, "timestamp": float} for last ~15s
    "detected_quotes": [],      # List of recently detected quote matches
    "quote_detection_enabled": True,
}

# Internal: dedup set for recently detected quote references
_recent_quote_refs = {}  # ref_key -> timestamp

# Constants for continuous quote detection
QUOTE_BUFFER_SECONDS = 15
QUOTE_PHRASE_MIN = 5
QUOTE_PHRASE_MAX = 20
QUOTE_DETECTION_INTERVAL = 1.5
QUOTE_CONFIDENCE_THRESHOLD = 82
QUOTE_DEDUP_SECONDS = 30

# Connected clients
active_websockets = set()

# Auto-clear task handle
auto_clear_task = None

async def set_active_scripture(scripture_data):
    """Set active scripture and schedule auto-clear."""
    global auto_clear_task

    # Cancel any existing auto-clear
    if auto_clear_task is not None:
        auto_clear_task.cancel()
        auto_clear_task = None

    state["active_scripture"] = scripture_data

    # Track context for semantic search (QV-07)
    if scripture_data is not None and scripture_data.get("book"):
        state["context_book"] = scripture_data["book"]
        state["context_chapter"] = scripture_data.get("chapter")

    # Schedule auto-clear if duration is set
    duration = state.get("display_duration", 0)
    if scripture_data is not None and duration > 0:
        async def auto_clear():
            await asyncio.sleep(duration)
            state["active_scripture"] = None
            await broadcast_state()

        auto_clear_task = asyncio.create_task(auto_clear())

    await broadcast_state()

async def clear_active_scripture():
    """Clear active scripture and cancel auto-clear."""
    global auto_clear_task
    if auto_clear_task is not None:
        auto_clear_task.cancel()
        auto_clear_task = None
    state["active_scripture"] = None
    await broadcast_state()

async def _reload_active_scripture():
    """Re-fetch the active scripture in the current translation."""
    cur = state["active_scripture"]
    if cur is None or not cur.get("book"):
        return
    scripture = get_scripture(
        state["current_translation"],
        cur["book"], cur["chapter"],
        cur.get("verse_start"), cur.get("verse_end")
    )
    if "error" not in scripture and scripture["verses"]:
        await set_active_scripture({
            "reference": scripture["reference"],
            "text": scripture["combined_text"],
            "book": cur["book"],
            "chapter": cur["chapter"],
            "verse_start": cur.get("verse_start"),
            "verse_end": cur.get("verse_end")
        })
    else:
        await clear_active_scripture()

async def _safe_send(message_str):
    """Send a message to all connected websockets, removing dead connections."""
    dead = set()
    for ws in list(active_websockets):
        try:
            await ws.send_text(message_str)
        except Exception:
            dead.add(ws)
    if dead:
        active_websockets.difference_update(dead)

# Helper to broadcast state to all clients
async def broadcast_state():
    if not active_websockets:
        return
    message = json.dumps({
        "type": "state",
        "current_translation": state["current_translation"],
        "display_duration": state["display_duration"],
        "active_scripture": state["active_scripture"],
        "recent_transcripts": state["recent_transcripts"],
        "context_book": state.get("context_book"),
        "context_chapter": state.get("context_chapter"),
        "rolling_buffer_text": _get_recent_buffer_text(),
        "detected_quotes": state["detected_quotes"],
        "quote_detection_enabled": state["quote_detection_enabled"],
    })
    await _safe_send(message)

async def _display_candidate(candidate):
    """Look up full verse text and display it."""
    scripture = get_scripture(
        state["current_translation"],
        candidate["book"],
        candidate["chapter"],
        candidate["verse_start"],
        candidate["verse_end"]
    )
    if "error" not in scripture and scripture["verses"]:
        await set_active_scripture({
            "reference": scripture["reference"],
            "text": scripture["combined_text"],
            "book": candidate["book"],
            "chapter": candidate["chapter"],
            "verse_start": candidate["verse_start"],
            "verse_end": candidate["verse_end"]
        })
        return True
    return False


async def _merge_candidates(regex_candidates, semantic_candidates):
    """Merge regex and semantic candidates, deduplicating by reference."""
    seen = set()
    merged = []
    for c in regex_candidates + semantic_candidates:
        key = f"{c['book']}|{c['chapter']}|{c.get('verse_start')}|{c.get('verse_end')}"
        if key not in seen:
            seen.add(key)
            merged.append(c)
    merged.sort(key=lambda c: c["confidence"], reverse=True)
    return merged


def _extract_phrases(text):
    """Extract overlapping 5-20 word phrases from text for semantic matching."""
    words = text.strip().split()
    if len(words) < QUOTE_PHRASE_MIN:
        return []
    phrases = []
    seen = set()
    max_len = min(QUOTE_PHRASE_MAX, len(words))
    for length in range(QUOTE_PHRASE_MIN, max_len + 1, 5):
        step = max(1, length // 3)
        for start in range(0, len(words) - length + 1, step):
            phrase = " ".join(words[start:start + length])
            key = " ".join(words[start:start + 3])
            if key not in seen:
                seen.add(key)
                phrases.append(phrase)
    return phrases[:30]  # Cap at 30 phrases per cycle


def _get_recent_buffer_text():
    """Get combined text from the last QUOTE_BUFFER_SECONDS from rolling_buffer."""
    now = time.time()
    cutoff = now - QUOTE_BUFFER_SECONDS
    recent = [entry["text"] for entry in state["rolling_buffer"] if entry["timestamp"] >= cutoff]
    return " ".join(recent).strip()


def _is_recently_detected(ref_key):
    """Check if a verse ref was detected recently (within dedup window)."""
    now = time.time()
    # Clean stale entries
    stale = [k for k, v in _recent_quote_refs.items() if now - v > QUOTE_DEDUP_SECONDS]
    for k in stale:
        del _recent_quote_refs[k]
    if ref_key in _recent_quote_refs:
        return True
    _recent_quote_refs[ref_key] = now
    return False


async def _quote_detection_loop():
    """Background loop: every 1.5s, extract phrases from rolling buffer and match against Bible verses."""
    while True:
        await asyncio.sleep(QUOTE_DETECTION_INTERVAL)

        # Always broadcast current state (rolling buffer, detected quotes) at this interval
        await broadcast_state()

        if not state.get("quote_detection_enabled", True):
            continue

        text = _get_recent_buffer_text()
        if not text or len(text.split()) < QUOTE_PHRASE_MIN:
            continue
        phrases = _extract_phrases(text)
        if not phrases:
            continue
        for phrase in phrases:
            try:
                candidates = search_similar_verses(
                    phrase,
                    translation=state["current_translation"],
                    context_book=state.get("context_book"),
                    context_chapter=state.get("context_chapter"),
                    top_k=1
                )
            except Exception:
                continue
            for c in candidates:
                if c["confidence"] >= QUOTE_CONFIDENCE_THRESHOLD:
                    ref_key = f"{c['book']}|{c['chapter']}|{c['verse_start']}"
                    if _is_recently_detected(ref_key):
                        continue
                    await _display_candidate(c)
                    quote_entry = {
                        "phrase": phrase,
                        "reference": f"{c['book']} {c['chapter']}:{c['verse_start']}",
                        "confidence": c["confidence"],
                        "book": c["book"],
                        "chapter": c["chapter"],
                        "verse_start": c["verse_start"],
                        "verse_end": c["verse_end"],
                        "text": c.get("text", ""),
                        "type": "semantic",
                        "timestamp": time.time()
                    }
                    state["detected_quotes"].insert(0, quote_entry)
                    if len(state["detected_quotes"]) > 15:
                        state["detected_quotes"].pop()
                    # Broadcast the new quote to all clients
                    quote_msg = json.dumps({
                        "type": "quote_detected",
                        "quote": quote_entry
                    })
                    if active_websockets:
                        await _safe_send(quote_msg)


# Helper to process transcript text and detect verses
async def process_transcript(text: str, is_final: bool = False):
    # Add to transcript history
    state["recent_transcripts"].append({"text": text, "is_final": is_final})
    if len(state["recent_transcripts"]) > 10:
        state["recent_transcripts"].pop(0)

    # Update rolling buffer for continuous quote detection (only final)
    if is_final:
        now = time.time()
        state["rolling_buffer"].append({"text": text, "timestamp": now})
        # Prune entries older than QUOTE_BUFFER_SECONDS
        cutoff = now - QUOTE_BUFFER_SECONDS
        state["rolling_buffer"] = [
            entry for entry in state["rolling_buffer"]
            if entry["timestamp"] >= cutoff
        ]
    
    # Broadcast raw transcript to clients (for scrolling display)
    transcript_msg = json.dumps({
        "type": "transcript",
        "text": text,
        "is_final": is_final
    })
    if active_websockets:
        await _safe_send(transcript_msg)
    
    # Only run detection on final transcripts
    if not is_final:
        return

    # Step 1: Parse with regex for explicit references
    regex_candidates = parse_text_for_verses(text)

    # Step 2: Run semantic search for quotes without references (QV-01, QV-02, QV-03)
    semantic_candidates = []
    if not regex_candidates or might_be_quote(text):
        semantic_candidates = search_similar_verses(
            text,
            translation=state["current_translation"],
            context_book=state.get("context_book"),
            context_chapter=state.get("context_chapter"),
            top_k=3 if regex_candidates else 5
        )

    # Step 3: Merge all candidates
    candidates = await _merge_candidates(regex_candidates, semantic_candidates)

    if candidates:
        # Broadcast candidates to the operator dashboard
        candidates_msg = json.dumps({
            "type": "candidate_verses",
            "candidates": candidates
        })
        if active_websockets:
            await _safe_send(candidates_msg)
        
        # QV-05: Auto-select highest >90% confidence, or show top 2-3
        high_conf = [c for c in candidates if c["confidence"] >= 90]
        if high_conf:
            # Auto-display the highest-confidence match
            await _display_candidate(high_conf[0])

# WebSocket endpoint
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_websockets.add(websocket)
    
    # Send initial state immediately
    await websocket.send_text(json.dumps({
        "type": "state",
        "current_translation": state["current_translation"],
        "display_duration": state["display_duration"],
        "active_scripture": state["active_scripture"],
        "recent_transcripts": state["recent_transcripts"],
        "context_book": state.get("context_book"),
        "context_chapter": state.get("context_chapter"),
        "rolling_buffer_text": _get_recent_buffer_text(),
        "detected_quotes": state.get("detected_quotes", []),
        "quote_detection_enabled": state.get("quote_detection_enabled", True),
    }))
    
    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            
            msg_type = msg.get("type")
            if msg_type == "clear":
                await clear_active_scripture()
                
            elif msg_type == "set_translation":
                state["current_translation"] = msg.get("translation", "KJV")
                if state["active_scripture"]:
                    await _reload_active_scripture()
                else:
                    await broadcast_state()
                
            elif msg_type == "set_duration":
                state["display_duration"] = int(msg.get("duration", 15))
                await broadcast_state()
                
            elif msg_type == "manual_verse":
                # Manual trigger by entering a reference like "John 3:16"
                verse_text = msg.get("verse_text", "")
                candidates = parse_text_for_verses(verse_text)
                if candidates:
                    await _display_candidate(candidates[0])
                    scripture = get_scripture(
                        state["current_translation"],
                        candidates[0]["book"],
                        candidates[0]["chapter"],
                        candidates[0]["verse_start"],
                        candidates[0]["verse_end"]
                    )
                    if "error" not in scripture and scripture["verses"]:
                        await websocket.send_text(json.dumps({
                            "type": "manual_verse_result",
                            "reference": scripture["reference"],
                            "text": scripture["combined_text"]
                        }))
                        
            elif msg_type == "manual_override":
                await set_active_scripture({
                    "reference": msg.get("reference", ""),
                    "text": msg.get("text", "")
                })
                
            elif msg_type == "toggle_quote_detection":
                state["quote_detection_enabled"] = msg.get("enabled", True)
                await broadcast_state()

            elif msg_type == "simulated_speech":
                # Simulated transcript message from dashboard
                speech_text = msg.get("text", "")
                await process_transcript(speech_text, is_final=True)
                
    except WebSocketDisconnect:
        active_websockets.remove(websocket)
    except Exception as e:
        print("WebSocket error:", e)
        if websocket in active_websockets:
            active_websockets.remove(websocket)

# HTML endpoints to serve frontend files directly for easy local opening
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

@app.get("/")
async def get_dashboard():
    dashboard_path = os.path.join(FRONTEND_DIR, "dashboard.html")
    if os.path.exists(dashboard_path):
        return FileResponse(dashboard_path)
    return HTMLResponse("Dashboard HTML file not found.", status_code=404)

@app.get("/screen")
async def get_screen():
    screen_path = os.path.join(FRONTEND_DIR, "screen.html")
    if os.path.exists(screen_path):
        return FileResponse(screen_path)
    return HTMLResponse("Screen HTML file not found.", status_code=404)

# API endpoint for verse preview (used by dashboard candidate cards)
@app.get("/api/verse")
async def api_verse_preview(book: str, chapter: int, verse: int = None):
    scripture = get_scripture(state["current_translation"], book, chapter, verse)
    return scripture

# Mount frontend files (css, js, images) at /frontend
if os.path.exists(FRONTEND_DIR):
    app.mount("/frontend", StaticFiles(directory=FRONTEND_DIR), name="frontend")
