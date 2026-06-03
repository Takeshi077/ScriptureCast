"""
ScriptureCast — Application Entry Point
Run with: python run.py
"""
import uvicorn
import sys
import os

# Ensure the project root is on the path so backend package imports work
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

if __name__ == "__main__":
    print("=" * 52)
    print("  ScriptureCast Server Starting")
    print("=" * 52)
    print("  Dashboard  →  http://localhost:8000")
    print("  Screen     →  http://localhost:8000/screen")
    print("  API Docs   →  http://localhost:8000/docs")
    print("=" * 52)
    print("  Press Ctrl+C to stop\n")

    uvicorn.run(
        "backend.app:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
        log_level="info",
    )
