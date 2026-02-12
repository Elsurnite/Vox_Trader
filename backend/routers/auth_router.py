# Vox Trader Backend - Auth routes (login, register)
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from database import get_db
from models import UserCreate, UserLogin, UserResponse, TokenResponse
from auth import hash_password, verify_password, create_access_token, decode_token
import pymysql

router = APIRouter(prefix="/auth", tags=["auth"])
security = HTTPBearer(auto_error=False)


def get_user_by_email(conn, email: str) -> dict | None:
    with conn.cursor(pymysql.cursors.DictCursor) as cur:
        cur.execute("SELECT id, email, name, password_hash, demo_balance, demo_mode, balance, created_at FROM users WHERE email = %s", (email,))
        return cur.fetchone()


@router.post("/register", response_model=TokenResponse)
def register(body: UserCreate):
    with get_db() as conn:
        if get_user_by_email(conn, body.email):
            raise HTTPException(status_code=400, detail="Email already registered")
        password_hash = hash_password(body.password)
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO users (email, password_hash, name, balance) VALUES (%s, %s, %s, 10.0)",
                (body.email, password_hash, body.name or body.email.split("@")[0]),
            )
            uid = cur.lastrowid
        conn.commit()
        user = get_user_by_email(conn, body.email)
    user_resp = UserResponse(
        id=user["id"],
        email=user["email"],
        name=user["name"],
        demo_balance=float(user.get("demo_balance", 10000)),
        demo_mode=bool(user.get("demo_mode", 0)),
        balance=float(user.get("balance", 0)),
        created_at=user["created_at"],
    )
    token = create_access_token({"sub": str(user["id"])})
    return TokenResponse(access_token=token, user=user_resp)


@router.post("/login", response_model=TokenResponse)
def login(body: UserLogin):
    with get_db() as conn:
        user = get_user_by_email(conn, body.email)
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    user_resp = UserResponse(
        id=user["id"],
        email=user["email"],
        name=user["name"],
        demo_balance=float(user.get("demo_balance", 10000)),
        demo_mode=bool(user.get("demo_mode", 0)),
        balance=float(user.get("balance", 0)),
        created_at=user["created_at"],
    )
    token = create_access_token({"sub": str(user["id"])})
    return TokenResponse(access_token=token, user=user_resp)


def get_current_user_id(credentials: HTTPAuthorizationCredentials = Depends(security)) -> int:
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_token(credentials.credentials)
    if not payload or "sub" not in payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    return int(payload["sub"])


@router.get("/me", response_model=UserResponse)
def me(user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute(
                "SELECT id, email, name, demo_balance, demo_mode, balance, created_at FROM users WHERE id = %s",
                (user_id,),
            )
            row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    row["demo_balance"] = float(row.get("demo_balance", 10000))
    row["demo_mode"] = bool(row.get("demo_mode", 0))
    row["balance"] = float(row.get("balance", 0))
    return UserResponse(**row)
