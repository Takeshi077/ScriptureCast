# ScriptureCast Architecture

## Chosen Approach: Railway Backend + Tauri Desktop Shell

### Overview
- **Backend**: Python/FastAPI hosted on Railway
- **Desktop App**: Lightweight Tauri shell that wraps the web UI in a native window
- **Database**: SQLite on Railway (persistent volume)
- **ML Models**: Sentence embeddings + TF-IDF run server-side on Railway

### Why This Approach

**Tauri Shell (~5MB download)**
- Users download and install a real desktop app with a native icon
- No browser tabs, no URL bookmarks
- Auto-updates via the backend — no re-downloading installers
- Windows, macOS, and Linux from a single codebase

**Railway Backend (~$5-10/mo)**
- Python + all ML deps run on the server — no bundling 500MB+ of models into the installer
- SQLite database is centralized (no sync issues across machines)
- Push backend updates once, all users get them instantly
- WebSocket support for live transcription and real-time display updates

### User Flow
1. User downloads and installs the Tauri app once
2. App opens a native window showing the dashboard or projector screen
3. App connects to the Railway backend over the internet
4. All processing (verse detection, transcription, ML search) happens server-side

### Trade-offs
- **Requires internet** — the app won't work offline
- **Centralized database** — all churches share one backend (or we add multi-tenant later)
- Simple, fast to build, easy to maintain

### Alternative (Not Chosen)
Fully self-contained Tauri + PyInstaller sidecar (~1-2GB download, no internet needed). Rejected because of large download size, fragile build pipeline, and harder maintenance.

### Recommended Hosting
- **Railway** — simple deploy from GitHub, persistent volumes for SQLite, WebSocket support
- **Fly.io** — good alternative with global regions
