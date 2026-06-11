import threading
import time
import numpy as np
import sounddevice as sd
import queue

# A queue to hold raw audio blocks from microphone callback
audio_queue = queue.Queue()

# A queue for transcription tasks to prevent blocking the capture loop
transcription_queue = queue.Queue()

# Transcriber status
is_listening = False
listen_thread = None
worker_thread = None

# ASR model
_model = None
_model_ready = False
_model_lock = threading.Lock()

# Audio capture settings
SAMPLE_RATE = 16000
CHANNELS = 1
<<<<<<< HEAD
BLOCK_DURATION = 0.5          # seconds per audio block
RMS_THRESHOLD = 0.015         # voice activity threshold (higher = less sensitive to background hum)
SILENCE_TIMEOUT = 1.2         # seconds of silence before finalising utterance (lower = faster response)
MAX_UTTERANCE = 30            # max seconds for a single utterance
MODEL_SIZE = "small"          # whisper model size (tiny/base/small/medium/large or .en versions)
=======
BLOCK_DURATION = 0.2          # seconds per audio block
RMS_THRESHOLD = 0.002         # voice activity threshold (lower = more sensitive)
SILENCE_TIMEOUT = 1.0         # seconds of silence before finalising utterance
MAX_UTTERANCE = 30            # max seconds for a single utterance
MODEL_SIZE = "small"          # whisper model size (tiny/base/small/medium/large-v3) — small is 10x faster than medium on CPU
>>>>>>> 53df082e90cbb134eb9e108464397e631a84a717

def init_model():
    """Eagerly load the ASR model at startup. Returns True if successful."""
    global _model, _model_ready
    if _model_ready:
        return True
    with _model_lock:
        if _model_ready:
            return True
        try:
            from faster_whisper import WhisperModel
            print(f"  Loading faster-whisper ({MODEL_SIZE}) model… (first download may take a minute)")
            _model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8", local_files_only=True)
            _model_ready = True
            print("  ASR model loaded successfully.")
            return True
        except ImportError:
            print("  WARNING: faster-whisper not installed. ASR disabled.")
            print("  Install with: pip install faster-whisper")
            return False
        except Exception as e:
            print(f"  WARNING: Failed to load ASR model: {e}")
            return False

def _model_available():
    return _model_ready

def audio_callback(indata, frames, time_info, status):
    if status:
        # Only print warnings if they are not standard overflow (since background threads handle transcription)
        if "overflow" not in str(status).lower():
            print("Audio status warning:", status)
    audio_queue.put(indata.copy())

def transcription_worker():
    """Background worker that pulls finished speech audio and transcribes it using Whisper."""
    global _model, _model_ready
    while is_listening:
        try:
            task = transcription_queue.get(timeout=0.5)
        except queue.Empty:
            continue
        if task is None:
            break
        
        audio_np, callback_fn = task
        try:
            if _model_ready and _model is not None:
                segments, _ = _model.transcribe(
                    audio_np,
                    beam_size=1,
                    language="en",
                    vad_filter=True,
                    vad_parameters=dict(min_silence_duration_ms=500)
                )
                text = " ".join(seg.text for seg in segments).strip()
                if text:
                    print(f"  ASR: {text}")
                    callback_fn(text)
        except Exception as e:
            print(f"  ASR transcription error: {e}")
        finally:
            transcription_queue.task_done()

def transcription_loop(callback_fn):
    global is_listening
    print("  Microphone input active — waiting for speech…")

    # Buffered audio for current utterance
    utterance_buffer = []
    silence_blocks = 0
    utterance_active = False
    blocks_since_last_speech = 0

    silence_blocks_limit = int(SILENCE_TIMEOUT / BLOCK_DURATION)
    max_utterance_blocks = int(MAX_UTTERANCE / BLOCK_DURATION)

    # Clear queue of any stale audio
    while not audio_queue.empty():
        try:
            audio_queue.get_nowait()
        except queue.Empty:
            break

    try:
        with sd.InputStream(samplerate=SAMPLE_RATE, channels=CHANNELS, callback=audio_callback,
                            blocksize=int(SAMPLE_RATE * BLOCK_DURATION)):
            while is_listening:
                try:
                    audio_block = audio_queue.get(timeout=0.5)
                except queue.Empty:
                    if utterance_active:
                        silence_blocks += 1
                        if silence_blocks >= silence_blocks_limit:
                            _finalise_utterance(utterance_buffer, callback_fn)
                            utterance_buffer = []
                            utterance_active = False
                            silence_blocks = 0
                    continue

                # Compute RMS
                rms = np.sqrt(np.mean(audio_block**2))
                is_speech = rms > RMS_THRESHOLD

                if is_speech:
                    if not utterance_active:
                        utterance_active = True
                        silence_blocks = 0
                        utterance_buffer = []
                    utterance_buffer.append(audio_block.copy())
                    silence_blocks = 0
                    blocks_since_last_speech += 1
                    if blocks_since_last_speech >= max_utterance_blocks:
                        _finalise_utterance(utterance_buffer, callback_fn)
                        utterance_buffer = []
                        utterance_active = False
                        silence_blocks = 0
                        blocks_since_last_speech = 0
                elif utterance_active:
                    # Keep buffering during silence to capture trailing words
                    utterance_buffer.append(audio_block.copy())
                    silence_blocks += 1
                    blocks_since_last_speech = 0
                    if silence_blocks >= silence_blocks_limit:
                        _finalise_utterance(utterance_buffer, callback_fn)
                        utterance_buffer = []
                        utterance_active = False
                        silence_blocks = 0

    except Exception as e:
        print("  Could not start audio input stream (no mic detected or sound card error):", e)
        print("  ASR unavailable — use the Manual Verse Lookup or browser speech recognition instead.")
        while is_listening:
            time.sleep(1.0)

def _finalise_utterance(buffer, callback_fn):
    if not buffer or not _model_ready:
        return
    audio_np = np.concatenate(buffer, axis=0).flatten()
    if len(audio_np) < SAMPLE_RATE * 0.5:  # ignore <0.5s clips
        return
<<<<<<< HEAD
    # Enqueue the transcription task
    transcription_queue.put((audio_np, callback_fn))
=======

    audio_np = _normalise_audio(audio_np)

    try:
        segments, _ = _model.transcribe(
            audio_np,
            beam_size=3,
            language="en",
            condition_on_previous_text=False,
        )
        text = " ".join(seg.text for seg in segments).strip()
        if text:
            print(f"  ASR: {text}")
            callback_fn(text)
    except Exception as e:
        print(f"  ASR transcription error: {e}")
>>>>>>> 53df082e90cbb134eb9e108464397e631a84a717

def start_transcribing(callback_fn):
    global is_listening, listen_thread, worker_thread
    if is_listening:
        return

    is_listening = True
    
    # Start background transcription worker thread
    worker_thread = threading.Thread(target=transcription_worker, name="ASRWorker", daemon=True)
    worker_thread.start()

    listen_thread = threading.Thread(target=transcription_loop, args=(callback_fn,), name="ASRListener", daemon=True)
    listen_thread.start()

def stop_transcribing():
    global is_listening, listen_thread, worker_thread
    is_listening = False
    
    # Signal and join listener thread
    if listen_thread:
        listen_thread.join(timeout=2.0)
        listen_thread = None
        
    # Signal and join worker thread
    if worker_thread:
        transcription_queue.put(None)
        worker_thread.join(timeout=2.0)
        worker_thread = None
