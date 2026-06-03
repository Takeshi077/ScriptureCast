from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse
import asyncio
import json
import os
from contextlib import asynccontextmanager
from .parser import parse_text_for_verses
from .database import get_scripture
from .transcriber import init_model, start_transcribing, stop_transcribing

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Load ASR model then start transcription background thread
    init_model()
    loop = asyncio.get_running_loop()
    def handle_transcription(text):
        asyncio.run_coroutine_threadsafe(process_transcript(text, is_final=True), loop)

    start_transcribing(handle_transcription)
    yield
    # Shutdown: Stop transcription
    stop_transcribing()

app = FastAPI(lifespan=lifespan)

# Global State
state = {
    "current_translation": "KJV",
    "display_duration": 15,
    "active_scripture": None,  # Will hold {"reference": "...", "text": "...", "book": "...", "chapter": N, "verse_start": N, "verse_end": N} or None
    "recent_transcripts": []    # List of {"text": "...", "is_final": bool}
}

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

# Helper to broadcast state to all clients
async def broadcast_state():
    if not active_websockets:
        return
    message = json.dumps({
        "type": "state",
        "current_translation": state["current_translation"],
        "display_duration": state["display_duration"],
        "active_scripture": state["active_scripture"],
        "recent_transcripts": state["recent_transcripts"]
    })
    await asyncio.gather(*[ws.send_text(message) for ws in active_websockets])

# Helper to process transcript text and detect verses
async def process_transcript(text: str, is_final: bool = False):
    # Add to transcript history
    state["recent_transcripts"].append({"text": text, "is_final": is_final})
    if len(state["recent_transcripts"]) > 10:
        state["recent_transcripts"].pop(0)
    
    # Broadcast raw transcript to clients (for scrolling display)
    transcript_msg = json.dumps({
        "type": "transcript",
        "text": text,
        "is_final": is_final
    })
    if active_websockets:
        await asyncio.gather(*[ws.send_text(transcript_msg) for ws in active_websockets])
    
    # Parse text for verses
    candidates = parse_text_for_verses(text)
    if candidates:
        # Broadcast candidates to the operator dashboard
        candidates_msg = json.dumps({
            "type": "candidate_verses",
            "candidates": candidates
        })
        if active_websockets:
            await asyncio.gather(*[ws.send_text(candidates_msg) for ws in active_websockets])
        
        # Check if we have a high-confidence candidate to auto-display
        # VD-05: 85% auto-display
        high_conf_candidates = [c for c in candidates if c["confidence"] >= 85]
        if high_conf_candidates:
            # Display the first high-confidence match
            candidate = high_conf_candidates[0]
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
        "recent_transcripts": state["recent_transcripts"]
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
                    candidate = candidates[0]
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
                        
            elif msg_type == "manual_override":
                await set_active_scripture({
                    "reference": msg.get("reference", ""),
                    "text": msg.get("text", "")
                })
                
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
