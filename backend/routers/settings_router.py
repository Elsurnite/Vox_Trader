# Vox Trader Backend - Settings (Binance API, demo mode)
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from database import get_db
from routers.auth_router import get_current_user_id
from models import BinanceKeysUpdate, BinanceKeysResponse
from encryption import encrypt_api_value, decrypt_api_value
import pymysql

router = APIRouter(prefix="/settings", tags=["settings"])


def _get_binance_row(conn, user_id: int) -> dict | None:
    with conn.cursor(pymysql.cursors.DictCursor) as cur:
        cur.execute(
            "SELECT encrypted_api_key, encrypted_api_secret FROM binance_api_keys WHERE user_id = %s",
            (user_id,),
        )
        return cur.fetchone()


@router.get("/binance", response_model=BinanceKeysResponse)
def get_binance_keys(user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        row = _get_binance_row(conn, user_id)
    if not row or not row.get("encrypted_api_key"):
        return BinanceKeysResponse(has_keys=False, api_key_masked=None)
    try:
        decrypted = decrypt_api_value(row["encrypted_api_key"])
        masked = (decrypted[:4] + "..." + decrypted[-4:]) if len(decrypted) >= 8 else "****"
    except Exception:
        masked = "****"
    return BinanceKeysResponse(has_keys=True, api_key_masked=masked)


@router.put("/binance")
def save_binance_keys(
    body: BinanceKeysUpdate,
    user_id: int = Depends(get_current_user_id),
):
    if not body.api_key or not body.api_secret:
        raise HTTPException(status_code=400, detail="API key and secret are required")
    encrypted_key = encrypt_api_value(body.api_key.strip())
    encrypted_secret = encrypt_api_value(body.api_secret.strip())
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO binance_api_keys (user_id, encrypted_api_key, encrypted_api_secret)
                VALUES (%s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    encrypted_api_key = VALUES(encrypted_api_key),
                    encrypted_api_secret = VALUES(encrypted_api_secret),
                    updated_at = CURRENT_TIMESTAMP
                """,
                (user_id, encrypted_key, encrypted_secret),
            )
    return {"ok": True, "message": "Binance API credentials saved."}


class DemoModeUpdate(BaseModel):
    enabled: bool


@router.get("/demo-mode")
def get_demo_mode(user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute("SELECT demo_mode FROM users WHERE id = %s", (user_id,))
            row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return {"demo_mode": bool(row.get("demo_mode", 0))}


@router.put("/demo-mode")
def set_demo_mode(body: DemoModeUpdate, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE users SET demo_mode = %s WHERE id = %s", (1 if body.enabled else 0, user_id))
    return {"ok": True, "demo_mode": body.enabled}
