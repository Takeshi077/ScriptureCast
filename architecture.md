# ScriptureCast Architecture

## Chosen Approach: Railway Backend + Tauri Desktop Shell

### Overview
- **Backend**: Python/FastAPI hosted on Railway
- **Desktop App**: Lightweight Tauri shell that wraps the web UI in a native window
- **Database**: SQLite on Railway (persistent volume) — bible verses + user accounts
- **ML Models**: Sentence embeddings + TF-IDF run server-side on Railway
- **Auth**: Email + password with JWT tokens (bcrypt hashing)

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
2. App opens to the landing page
3. User signs up or logs in (email + password)
4. App stores JWT token locally for persistent sessions
5. Dashboard and projector screen are behind authentication
6. All processing (verse detection, transcription, ML search) happens server-side

### Pages
| Route | Page | Auth Required |
|-------|------|---------------|
| `/` | Landing page | No |
| `/login` | Login form | No |
| `/register` | Registration form | No |
| `/app` | Operator dashboard | Yes |
| `/screen` | Projector display screen | Yes |

### API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Create account (email, password, name) |
| POST | `/api/auth/login` | Sign in, returns JWT + sets cookie |
| GET | `/api/auth/me` | Get current user info |
| POST | `/api/auth/logout` | Clear session |

### Monetization Plan
- Free trial period (14 days)
- Monthly subscription via Stripe ($10-30/mo depending on tiers)
- Check subscription status on login; redirect expired accounts to billing page
- Stripe integration handles payment forms and webhooks

### Project Structure
```
ScriptureCast/
├── backend/
│   ├── app.py          # FastAPI app, routes, WebSocket
│   ├── auth.py         # Auth module (JWT, bcrypt, endpoints)
│   ├── database.py     # Bible verse SQLite queries
│   ├── parser.py       # Verse reference regex parser
│   ├── semantic.py     # Semantic search (TF-IDF + embeddings)
│   └── transcriber.py  # Audio capture / transcription
├── frontend/
│   ├── index.html      # Landing page
│   ├── login.html      # Login page
│   ├── register.html   # Registration page
│   ├── dashboard.html  # Operator dashboard (behind auth)
│   ├── screen.html     # Projector display (behind auth)
│   ├── css/
│   │   ├── auth.css    # Landing + auth page styles
│   │   ├── dashboard.css
│   │   └── screen.css
│   └── js/
│       ├── auth.js     # Auth form handling
│       ├── dashboard.js
│       └── screen.js
├── data/
│   ├── bible.db        # Scripture database
│   ├── users.db        # User accounts
│   └── embeddings/     # TF-IDF cache
└── run.py              # Entry point
```

### Trade-offs
- **Requires internet** — the app won't work offline
- **Centralized database** — all churches share one backend (multi-tenant later)
- Simple, fast to build, easy to maintain

### Alternative (Not Chosen)
Fully self-contained Tauri + PyInstaller sidecar (~1-2GB download, no internet needed). Rejected because of large download size, fragile build pipeline, and harder maintenance.

### Recommended Hosting
- **Railway** — simple deploy from GitHub, persistent volumes for SQLite, WebSocket support
- **Fly.io** — good alternative with global regions
