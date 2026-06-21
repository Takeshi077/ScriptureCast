import os
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, HTTPException, Depends, status, Request, Response
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUTH_DB_PATH = os.path.join(BASE_DIR, "data", "users.db")
DATABASE_URL = os.environ.get("DATABASE_URL")
JWT_SECRET = os.environ.get("JWT_SECRET", "sc-secret-change-in-production-2024")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = 60 * 24 * 7

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)

router = APIRouter(prefix="/api/auth", tags=["auth"])

class UserCreate(BaseModel):
    email: str
    password: str
    name: str

class UserLogin(BaseModel):
    email: str
    password: str

class UserResponse(BaseModel):
    id: int
    email: str
    name: str

USE_POSTGRES = bool(DATABASE_URL)

if USE_POSTGRES:
    try:
        import psycopg2
        from psycopg2.extras import RealDictCursor
    except ImportError:
        raise RuntimeError(
            "DATABASE_URL is set but psycopg2 is not installed. "
            "Run: pip install psycopg2-binary"
        )

def _get_conn():
    if USE_POSTGRES:
        conn = psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)
        conn.autocommit = False
        return conn
    else:
        import sqlite3
        os.makedirs(os.path.dirname(AUTH_DB_PATH), exist_ok=True)
        conn = sqlite3.connect(AUTH_DB_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

def _execute(conn, sql, params=None):
    if USE_POSTGRES:
        pg_sql = sql.replace("?", "%s")
        pg_sql = pg_sql.replace("datetime('now')", "NOW()")
        pg_sql = pg_sql.replace("AUTOINCREMENT", "GENERATED ALWAYS AS IDENTITY")
        cur = conn.cursor()
        cur.execute(pg_sql, params or ())
        return cur
    return conn.execute(sql, params or ())

def _fetchone(cursor):
    row = cursor.fetchone()
    if row is None:
        return None
    return dict(row)

def _is_unique_violation(exc):
    if USE_POSTGRES:
        return getattr(exc, 'pgcode', None) == '23505'
    else:
        import sqlite3
        return isinstance(exc, sqlite3.IntegrityError)

def _init_db():
    conn = _get_conn()
    try:
        if USE_POSTGRES:
            _execute(conn, """
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    email TEXT UNIQUE NOT NULL,
                    password TEXT NOT NULL,
                    name TEXT NOT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT NOW()
                )
            """)
        else:
            _execute(conn, """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    email TEXT UNIQUE NOT NULL,
                    password TEXT NOT NULL,
                    name TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                )
            """)
        conn.commit()
    finally:
        conn.close()

_init_db()

def _create_token(user_id: int, email: str) -> str:
    payload = {
        "sub": str(user_id),
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def _extract_token(headers, cookies):
    token = None
    auth_header = headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]
    if not token:
        token = cookies.get("access_token")
    return token

def get_current_user(request: Request) -> dict | None:
    token = _extract_token(request.headers, request.cookies)
    if not token:
        return None
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("sub")
        email = payload.get("email")
        if user_id is None:
            return None
        return {"id": int(user_id), "email": email}
    except JWTError:
        return None

def get_current_user_from_ws(websocket) -> dict | None:
    token = _extract_token(websocket.headers, websocket.cookies)
    if not token:
        token = websocket.query_params.get("token")
    if not token:
        return None
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("sub")
        email = payload.get("email")
        if user_id is None:
            return None
        return {"id": int(user_id), "email": email}
    except JWTError:
        return None

async def require_user(request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user

@router.post("/register")
async def register(user: UserCreate):
    if not user.email or not user.password or not user.name:
        raise HTTPException(status_code=400, detail="Email, password, and name required")
    if len(user.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    conn = _get_conn()
    try:
        hashed = pwd_context.hash(user.password)
        _execute(conn,
            "INSERT INTO users (email, password, name) VALUES (?, ?, ?)",
            (user.email.lower().strip(), hashed, user.name.strip())
        )
        conn.commit()
        row = _fetchone(_execute(conn,
            "SELECT id, email, name FROM users WHERE email = ?",
            (user.email.lower().strip(),)
        ))
        token = _create_token(row["id"], row["email"])
        return {"token": token, "user": {"id": row["id"], "email": row["email"], "name": row["name"]}}
    except Exception as exc:
        conn.rollback()
        if _is_unique_violation(exc):
            raise HTTPException(status_code=409, detail="Email already registered")
        raise
    finally:
        conn.close()

@router.post("/login")
async def login(user: UserLogin, response: Response):
    if not user.email or not user.password:
        raise HTTPException(status_code=400, detail="Email and password required")
    conn = _get_conn()
    try:
        row = _fetchone(_execute(conn,
            "SELECT id, email, password, name FROM users WHERE email = ?",
            (user.email.lower().strip(),)
        ))
        if not row or not pwd_context.verify(user.password, row["password"]):
            raise HTTPException(status_code=401, detail="Invalid email or password")
        token = _create_token(row["id"], row["email"])
        response.set_cookie(
            key="access_token",
            value=token,
            httponly=True,
            max_age=JWT_EXPIRE_MINUTES * 60,
            samesite="lax",
        )
        return {"token": token, "user": {"id": row["id"], "email": row["email"], "name": row["name"]}}
    finally:
        conn.close()

@router.get("/me")
async def get_me(request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    conn = _get_conn()
    try:
        row = _fetchone(_execute(conn,
            "SELECT id, email, name FROM users WHERE id = ?", (user["id"],)
        ))
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        return {"id": row["id"], "email": row["email"], "name": row["name"]}
    finally:
        conn.close()

@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie("access_token")
    return {"ok": True}
