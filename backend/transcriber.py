import threading
import time
import numpy as np
import sounddevice as sd
import queue

# A queue to hold raw audio blocks from microphone callback
audio_queue = queue.Queue()

# Transcriber status
is_listening = False
listen_thread = None

# ASR model
_model = None
_model_ready = False
_model_lock = threading.Lock()

# Audio capture settings
SAMPLE_RATE = 16000
CHANNELS = 1
BLOCK_DURATION = 0.5          # seconds per audio block
RMS_THRESHOLD = 0.005         # voice activity threshold (lower = more sensitive)
SILENCE_TIMEOUT = 2.5         # seconds of silence before finalising utterance
MAX_UTTERANCE = 30            # max seconds for a single utterance
MODEL_SIZE = "small"          # whisper model size (tiny/base/small/medium/large)

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
            _model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")
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
        print("Audio status warning:", status)
    audio_queue.put(indata.copy())

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

    try:
        with sd.InputStream(samplerate=SAMPLE_RATE, channels=CHANNELS, callback=audio_callback,
                            blocksize=int(SAMPLE_RATE * BLOCK_DURATION)):
            while is_listening:
                try:
                    audio_block = audio_queue.get(timeout=1.0)
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
        print("  ASR unavailable — use simulated speech from the dashboard instead.")
        while is_listening:
            time.sleep(1.0)

def _finalise_utterance(buffer, callback_fn):
    if not buffer or not _model_ready:
        return
    audio_np = np.concatenate(buffer, axis=0).flatten()
    if len(audio_np) < SAMPLE_RATE * 0.5:  # ignore <0.5s clips
        return

    try:
        segments, _ = _model.transcribe(audio_np, beam_size=3, language="en")
        text = " ".join(seg.text for seg in segments).strip()
        if text:
            print(f"  ASR: {text}")
            callback_fn(text)
    except Exception as e:
        print(f"  ASR transcription error: {e}")

def start_transcribing(callback_fn):
    global is_listening, listen_thread
    if is_listening:
        return

    is_listening = True
    listen_thread = threading.Thread(target=transcription_loop, args=(callback_fn,), daemon=True)
    listen_thread.start()

def stop_transcribing():
    global is_listening
    is_listening = False
    if listen_thread:
        listen_thread.join(timeout=2.0)
