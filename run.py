"""
ScriptureCast — Application Entry Point
Run with: python run.py
"""
import uvicorn
import sys
import os
import socket
import subprocess
import time

# Ensure the project root is on the path so backend package imports work
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

HOST = "0.0.0.0"
PORT = 8000

def free_port(host, port):
    """Kill any process currently bound to the given port (cross-platform)."""
    try:
        if sys.platform == "win32":
            result = subprocess.run(
                f'netstat -ano | findstr "LISTEN" | findstr ":{port} "',
                shell=True, capture_output=True, text=True, timeout=5
            )
            for line in result.stdout.strip().splitlines():
                parts = line.strip().split()
                if len(parts) >= 5:
                    pid = parts[-1]
                    subprocess.run(f"taskkill /F /PID {pid}", shell=True,
                                   capture_output=True, timeout=5)
                    print(f"  Killed stale process (PID {pid}) on port {port}")
        else:
            result = subprocess.run(
                f"lsof -ti:{port} 2>/dev/null", shell=True,
                capture_output=True, text=True, timeout=5
            )
            for pid in result.stdout.strip().splitlines():
                if pid:
                    subprocess.run(f"kill -9 {pid}", shell=True, timeout=5)
                    print(f"  Killed stale process (PID {pid}) on port {port}")
    except Exception:
        pass

def wait_for_port_free(host, port, timeout=5):
    """Wait up to `timeout` seconds for the port to become free."""
    for _ in range(timeout * 2):
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                time.sleep(0.5)
        except (ConnectionRefusedError, OSError):
            return True
    return False

if __name__ == "__main__":
    free_port(HOST, PORT)
    wait_for_port_free(HOST, PORT)

    print("=" * 52)
    print("  ScriptureCast Server Starting")
    print("=" * 52)
    print(f"  Dashboard   -> http://localhost:{PORT}")
    print(f"  Screen      -> http://localhost:{PORT}/screen")
    print(f"  API Docs    -> http://localhost:{PORT}/docs")
    print("=" * 52)
    print("  Press Ctrl+C to stop\n")

    uvicorn.run(
        "backend.app:app",
        host=HOST,
        port=PORT,
        reload=False,
        log_level="info",
        ws_max_size=16777216,
        ws_ping_interval=30,
        ws_ping_timeout=10,
    )
