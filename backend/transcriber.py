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

def audio_callback(indata, frames, time_info, status):
    """Callback function for sounddevice to capture audio streams."""
    if status:
        print("Audio status warning:", status)
    audio_queue.put(indata.copy())

def transcription_loop(callback_fn):
    """Background loop that processes audio queue and transcribes speech."""
    global is_listening
    print("ASR Engine listening loop started.")
    
    # Setup standard audio capture settings (16kHz mono)
    sample_rate = 16000
    channels = 1
    
    # We can implement a simple voice activity detector or chunk-based processing
    # In a full Whisper.cpp implementation, we feed these audio chunks to Whisper's C++ interface.
    # For this offline/local Python server, we will provide a framework that prints audio level.
    # If the user is running in mock/demo mode, we also have mock speech trigger.
    
    # Start microphone stream
    try:
        with sd.InputStream(samplerate=sample_rate, channels=channels, callback=audio_callback):
            while is_listening:
                # Get audio block (this is non-blocking with timeout to check loop status)
                try:
                    audio_block = audio_queue.get(timeout=1.0)
                    
                    # Compute volume level (RMS) to show signal health
                    rms = np.sqrt(np.mean(audio_block**2))
                    if rms > 0.05: # Simple threshold gate
                        # Here, we would run whisper model inference:
                        # result = whisper_model.transcribe(audio_data)
                        # callback_fn(result["text"])
                        pass
                except queue.Empty:
                    continue
                except Exception as e:
                    print("Error processing audio block:", e)
                    break
    except Exception as e:
        print("Could not start audio input stream (no mic detected or sound card error):", e)
        print("Falling back to simulated/dashboard manual input only.")
        while is_listening:
            time.sleep(1.0)

def start_transcribing(callback_fn):
    """Starts the real-time audio transcription background thread."""
    global is_listening, listen_thread
    if is_listening:
        return
    
    is_listening = True
    listen_thread = threading.Thread(target=transcription_loop, args=(callback_fn,), daemon=True)
    listen_thread.start()

def stop_transcribing():
    """Stops the real-time audio transcription."""
    global is_listening
    is_listening = False
    if listen_thread:
        listen_thread.join(timeout=2.0)
