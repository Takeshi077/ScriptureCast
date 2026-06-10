from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse
import asyncio
import json
import os
import time
import tempfile
from contextlib import asynccontextmanager
from .parser import parse_text_for_verses
from .database import get_scripture

import assemblyai as aai
import requests

# Configure AssemblyAI API key
aai.settings.api_key = os.environ.get("ASSEMBLYAI_API_KEY", "6a43fbd351cc4b42a4ea4135f34b5fab")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # AssemblyAI integration uses browser streaming. Local faster-whisper ASR is disabled.
    yield

app = FastAPI(lifespan=lifespan)

# Global State
state = {
    "current_translation": "KJV",
    "display_duration": 15,
    "active_scripture": None,  # Will hold {"reference": "...", "text": "...", "book": "...", "chapter": N, "verse_start": N, "verse_end": N} or None
    "recent_transcripts": [],   # List of {"text": "...", "is_final": bool}
    "full_transcript": "",      # Continuous accumulation of all transcript text
    "context_book": None,       # Last displayed book (for QV-07 context awareness)
    "context_chapter": None,    # Last displayed chapter
}

# Connected clients
active_websockets = set()

# Auto-clear task handle
auto_clear_task = None

# Minimum gap between auto-displays (seconds)
_last_display_time = 0.0

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
        except BaseException:
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
        "context_book": state.get("context_book"),
        "context_chapter": state.get("context_chapter"),
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


# Helper to process transcript text and detect verses
async def process_transcript(text: str, is_final: bool = False):
    # Add to transcript history
    state["recent_transcripts"].append({"text": text, "is_final": is_final})
    if len(state["recent_transcripts"]) > 10:
        state["recent_transcripts"].pop(0)

    # Accumulate into full transcript (like a long note)
    if is_final:
        MAX_NOTE_LENGTH = 10000
        if state["full_transcript"]:
            state["full_transcript"] += " " + text
            if len(state["full_transcript"]) > MAX_NOTE_LENGTH * 2:
                state["full_transcript"] = state["full_transcript"][-MAX_NOTE_LENGTH:]
        else:
            state["full_transcript"] = text

        # Broadcast transcript to all connected clients (only backend ASR, not browser echo)
        if active_websockets:
            transcript_msg = json.dumps({
                "type": "transcript",
                "text": text,
                "is_final": True
            })
            await _safe_send(transcript_msg)

    if not is_final:
        return

    # Parse with regex for explicit references
    candidates = parse_text_for_verses(text)

    if candidates:
        # Broadcast candidates to the operator dashboard
        candidates_msg = json.dumps({
            "type": "candidate_verses",
            "candidates": candidates
        })
        if active_websockets:
            await _safe_send(candidates_msg)

        # Auto-display verse references with high confidence
        global _last_display_time
        now = time.time()
        if now - _last_display_time >= 3.0:
            for c in candidates:
                if c["confidence"] >= 90:
                    _last_display_time = now
                    await _display_candidate(c)
                    break

# WebSocket endpoint
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_websockets.add(websocket)
    
    # Send initial state immediately
    try:
        await websocket.send_text(json.dumps({
            "type": "state",
            "current_translation": state["current_translation"],
            "display_duration": state["display_duration"],
            "active_scripture": state["active_scripture"],
            "full_transcript": "",
            "context_book": state.get("context_book"),
            "context_chapter": state.get("context_chapter"),
        }))
    except BaseException:
        active_websockets.discard(websocket)
        return
    
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
                        try:
                            await websocket.send_text(json.dumps({
                                "type": "manual_verse_result",
                                "reference": scripture["reference"],
                                "text": scripture["combined_text"]
                            }))
                        except BaseException:
                            pass
                        
            elif msg_type == "manual_override":
                await set_active_scripture({
                    "reference": msg.get("reference", ""),
                    "text": msg.get("text", "")
                })

            elif msg_type == "transcript":
                speech_text = msg.get("text", "")
                await process_transcript(speech_text, is_final=True)
                
    except WebSocketDisconnect:
        active_websockets.discard(websocket)
    except Exception as e:
        print("WebSocket error:", e)
        active_websockets.discard(websocket)
    except BaseException:
        active_websockets.discard(websocket)

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

@app.get("/api/token")
async def get_assemblyai_token():
    try:
        api_key = os.environ.get("ASSEMBLYAI_API_KEY", "6a43fbd351cc4b42a4ea4135f34b5fab")
        response = requests.get(
            "https://streaming.assemblyai.com/v3/token?expires_in_seconds=60",
            headers={"Authorization": api_key}
        )
        if response.status_code != 200:
            raise HTTPException(status_code=response.status_code, detail=f"Failed to fetch token from AssemblyAI: {response.text}")
        return response.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/transcribe")
async def api_transcribe(file: UploadFile = File(...)):
    """Transcribe an audio file using AssemblyAI API."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    suffix = os.path.splitext(file.filename or ".wav")[1] or ".wav"
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as f:
            tmp = f.name
            content = await file.read()
            f.write(content)

        transcriber = aai.Transcriber()
        config = aai.TranscriptionConfig(
            speech_models=["universal-3-pro", "universal-2"]
        )
        transcript = transcriber.transcribe(tmp, config=config)
        
        if transcript.status == aai.TranscriptStatus.error:
            raise Exception(transcript.error)
            
        return {"text": transcript.text, "language": "en"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if tmp and os.path.exists(tmp):
            os.unlink(tmp)

# Mount frontend files (css, js, images) at /frontend
if os.path.exists(FRONTEND_DIR):
    app.mount("/frontend", StaticFiles(directory=FRONTEND_DIR), name="frontend")
