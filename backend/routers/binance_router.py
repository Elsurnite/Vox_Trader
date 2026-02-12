# Vox Trader Backend - Binance proxy (klines public, myTrades signed)
import time
import hmac
import hashlib
import urllib.parse
from fastapi import APIRouter, HTTPException, Depends, Query
from database import get_db
from routers.auth_router import get_current_user_id
from encryption import decrypt_api_value
import pymysql
import httpx

router = APIRouter(prefix="/binance", tags=["binance"])
BINANCE_BASE = "https://api.binance.com"


def _get_user_credentials(user_id: int) -> tuple[str, str]:
    with get_db() as conn:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute(
                "SELECT encrypted_api_key, encrypted_api_secret FROM binance_api_keys WHERE user_id = %s",
                (user_id,),
            )
            row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=400, detail="Binance API keys are not saved. Please add them in Settings first.")
    try:
        key = decrypt_api_value(row["encrypted_api_key"])
        secret = decrypt_api_value(row["encrypted_api_secret"])
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to read API keys.")
    return key, secret


@router.get("/klines")
async def get_klines(
    symbol: str = Query("BTCUSDT", description="Symbol"),
    interval: str = Query("1m", description="1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 1d"),
    limit: int = Query(500, ge=1, le=1000),
):
    """Binance mum verisi (public)."""
    async with httpx.AsyncClient() as client:
        r = await client.get(
            f"{BINANCE_BASE}/api/v3/klines",
            params={"symbol": symbol.upper(), "interval": interval, "limit": limit},
            timeout=10.0,
        )
    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail=r.text)
    return r.json()


@router.get("/account")
async def get_account_balances(user_id: int = Depends(get_current_user_id)):
    """User Binance spot balances (only assets with total > 0)."""
    api_key, api_secret = _get_user_credentials(user_id)
    params = {
        "timestamp": int(time.time() * 1000),
        "recvWindow": 60000,
    }
    qs = urllib.parse.urlencode(params)
    sig = hmac.new(api_secret.encode(), qs.encode(), hashlib.sha256).hexdigest()
    url = f"{BINANCE_BASE}/api/v3/account?{qs}&signature={sig}"
    async with httpx.AsyncClient() as client:
        r = await client.get(url, headers={"X-MBX-APIKEY": api_key}, timeout=10.0)
    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail=r.text)
    data = r.json()
    balances = data.get("balances", [])
    # Return only assets where free or locked > 0
    out = []
    for b in balances:
        free = float(b.get("free", 0) or 0)
        locked = float(b.get("locked", 0) or 0)
        if free > 0 or locked > 0:
            out.append({"asset": b["asset"], "free": free, "locked": locked, "total": free + locked})
    return {"balances": out}


@router.get("/my-trades")
async def get_my_trades(
    user_id: int = Depends(get_current_user_id),
    symbol: str = Query("BTCUSDT"),
    limit: int = Query(50, ge=1, le=1000),
):
    """User Binance trade history (API key required)."""
    api_key, api_secret = _get_user_credentials(user_id)
    params = {
        "symbol": symbol.upper(),
        "limit": limit,
        "timestamp": int(time.time() * 1000),
        "recvWindow": 60000,
    }
    qs = urllib.parse.urlencode(params)
    sig = hmac.new(api_secret.encode(), qs.encode(), hashlib.sha256).hexdigest()
    url = f"{BINANCE_BASE}/api/v3/myTrades?{qs}&signature={sig}"
    async with httpx.AsyncClient() as client:
        r = await client.get(url, headers={"X-MBX-APIKEY": api_key}, timeout=10.0)
    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail=r.text)
    return r.json()


@router.get("/exchange-info")
async def get_exchange_info():
    """Symbol list (public)."""
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{BINANCE_BASE}/api/v3/exchangeInfo", timeout=10.0)
    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail=r.text)
    return r.json()
