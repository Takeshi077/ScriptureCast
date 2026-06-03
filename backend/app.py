from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse
import asyncio
import json
import os
from contextlib import asynccontextmanager
from .parser import parse_text_for_verses
from .database import get_scripture
from .transcriber import start_transcribing, stop_transcribing

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Start transcription background thread
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
    "active_scripture": None,  # Will hold {"reference": "...", "text": "..."} or None
    "recent_transcripts": []    # List of {"text": "...", "is_final": bool}
}

# Connected clients
active_websockets = set()

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
                state["active_scripture"] = {
                    "reference": scripture["reference"],
                    "text": scripture["combined_text"]
                }
                await broadcast_state()

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
                state["active_scripture"] = None
                await broadcast_state()
                
            elif msg_type == "set_translation":
                state["current_translation"] = msg.get("translation", "KJV")
                # If there's an active scripture, reload it with the new translation
                if state["active_scripture"]:
                    # We would need the parsed components, but for now we can just let it clear
                    # or re-fetch. To keep it simple, we clear it or reload. Let's just let it clear.
                    state["active_scripture"] = None
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
                        state["active_scripture"] = {
                            "reference": scripture["reference"],
                            "text": scripture["combined_text"]
                        }
                        await broadcast_state()
                        
            elif msg_type == "manual_override":
                # Operator directly forces specific text on screen
                state["active_scripture"] = {
                    "reference": msg.get("reference", ""),
                    "text": msg.get("text", "")
                }
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
FRONTEND_DIR = "c:\\Users\\user\\Desktop\\ScriptureCast\\frontend"

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

# Mount frontend files (css, js, images) at /frontend
if os.path.exists(FRONTEND_DIR):
    app.mount("/frontend", StaticFiles(directory=FRONTEND_DIR), name="frontend")
