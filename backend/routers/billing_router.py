from datetime import datetime
from typing import Optional
from urllib.parse import quote_plus

import httpx
import pymysql
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr, Field

from config import get_settings
from database import get_db
from routers.auth_router import get_current_user_id

router = APIRouter(prefix="/billing", tags=["billing"])


class TopupStartRequest(BaseModel):
    amount_usd: float = Field(gt=0, le=10000)
    customer_name: str
    customer_email: EmailStr
    customer_phone: str = ""
    shipping_address: str = "Digital Service"
    shipping_city: str = "Istanbul"
    shipping_district: str = "Kadikoy"
    card_holder: str = ""
    card_number: str
    expire_month: str
    expire_year: str
    cvc: str


def _frontend_redirect_url(status: str, order_number: str, amount: Optional[float] = None, error: str = "") -> str:
    s = get_settings()
    base = (s.FRONTEND_BASE_URL or "http://localhost:3000").rstrip("/")
    url = f"{base}/dashboard?topup={status}&order_number={order_number}"
    if amount is not None:
        url += f"&amount={amount:.2f}"
    if error:
        url += f"&error={quote_plus(error)}"
    return url


def _is_order_paid(order_payload: dict) -> bool:
    data = (order_payload or {}).get("data") or {}
    status = str(data.get("status") or "").lower()
    status_label = str(data.get("status_label") or "").lower()
    payment_status = str(data.get("payment_status") or "").lower()
    if status in {"paid", "completed", "delivered", "success"}:
        return True
    if payment_status in {"paid", "success", "completed"}:
        return True
    if "teslim" in status_label:
        return True
    return False


@router.post("/topup/start")
def start_topup(body: TopupStartRequest, user_id: int = Depends(get_current_user_id)):
    s = get_settings()
    if not s.MAGAZALA_API_KEY:
        raise HTTPException(status_code=503, detail="MAGAZALA_API_KEY is not configured.")

    callback_url = f"{(s.BACKEND_PUBLIC_URL or 'http://localhost:8423').rstrip('/')}/billing/topup/callback"
    amount = round(float(body.amount_usd), 2)

    payload = {
        "customer_name": body.customer_name,
        "customer_email": body.customer_email,
        "customer_phone": body.customer_phone or "05000000000",
        "shipping_address": body.shipping_address or "Digital Service",
        "shipping_city": body.shipping_city or "Istanbul",
        "shipping_district": body.shipping_district or "Kadikoy",
        "card_holder": body.card_holder or body.customer_name,
        "card_number": body.card_number,
        "expire_month": body.expire_month,
        "expire_year": body.expire_year,
        "cvc": body.cvc,
        "callback_url": callback_url,
        "currency": "USD",
        "items": [
            {
                "name": "Vox Trader Balance Top-up",
                "quantity": 1,
                "price": amount,
            }
        ],
    }

    url = f"{(s.MAGAZALA_BASE_URL or 'https://magazala.com/api/v1').rstrip('/')}/payment"
    try:
        with httpx.Client(timeout=httpx.Timeout(20.0, read=60.0)) as client:
            r = client.post(
                url,
                headers={
                    "Authorization": f"Bearer {s.MAGAZALA_API_KEY}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
    except Exception:
        raise HTTPException(status_code=502, detail="Could not connect to payment service.")

    data = {}
    try:
        data = r.json()
    except Exception:
        data = {}

    if r.status_code != 200 or not data.get("success"):
        raise HTTPException(status_code=400, detail=data.get("message") or "Payment could not be started.")

    topup_data = data.get("data") or {}
    order_number = str(topup_data.get("order_number") or "").strip()
    threeds_html = topup_data.get("threeds_html") or ""
    if not order_number or not threeds_html:
        raise HTTPException(status_code=502, detail="Payment response is missing: order_number / threeds_html.")

    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO balance_topups (user_id, order_number, amount_usd, status, provider, callback_payload, created_at, updated_at)
                VALUES (%s, %s, %s, 'pending', 'magazala', %s, %s, %s)
                ON DUPLICATE KEY UPDATE amount_usd=VALUES(amount_usd), callback_payload=VALUES(callback_payload), updated_at=VALUES(updated_at)
                """,
                (user_id, order_number, amount, "", datetime.utcnow(), datetime.utcnow()),
            )
            conn.commit()

    return {"success": True, "order_number": order_number, "threeds_html": threeds_html}


@router.get("/topup/callback")
def topup_callback(
    status: str = Query(default=""),
    order_number: str = Query(default=""),
    payment_id: str = Query(default=""),
    total: Optional[float] = Query(default=None),
    error: str = Query(default=""),
):
    if not order_number:
        return RedirectResponse(_frontend_redirect_url("failed", "unknown", error="missing_order_number"), status_code=302)

    s = get_settings()
    paid = False

    # Check callback status first, then verify order
    if (status or "").lower() == "success":
        verify_url = f"{(s.MAGAZALA_BASE_URL or 'https://magazala.com/api/v1').rstrip('/')}/orders/{order_number}"
        try:
            with httpx.Client(timeout=httpx.Timeout(20.0, read=45.0)) as client:
                vr = client.get(
                    verify_url,
                    headers={"Authorization": f"Bearer {s.MAGAZALA_API_KEY}"},
                )
            vdata = vr.json() if vr.status_code == 200 else {}
            paid = _is_order_paid(vdata) or bool(vdata.get("success"))
        except Exception:
            paid = False

    with get_db() as conn:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute("SELECT id, user_id, amount_usd, status FROM balance_topups WHERE order_number = %s FOR UPDATE", (order_number,))
            row = cur.fetchone()
            if not row:
                conn.commit()
                return RedirectResponse(_frontend_redirect_url("failed", order_number, error="order_not_found"), status_code=302)

            # Idempotent
            if row["status"] == "success":
                conn.commit()
                return RedirectResponse(_frontend_redirect_url("success", order_number, float(row["amount_usd"])), status_code=302)

            payload_log = f"status={status}&payment_id={payment_id}&total={total}&error={error}"
            if paid:
                cur.execute("UPDATE users SET balance = balance + %s WHERE id = %s", (float(row["amount_usd"]), row["user_id"]))
                cur.execute(
                    """
                    UPDATE balance_topups
                    SET status='success', payment_id=%s, callback_payload=%s, credited_at=%s, updated_at=%s
                    WHERE id = %s
                    """,
                    (payment_id, payload_log[:65535], datetime.utcnow(), datetime.utcnow(), row["id"]),
                )
                conn.commit()
                return RedirectResponse(_frontend_redirect_url("success", order_number, float(row["amount_usd"])), status_code=302)

            cur.execute(
                """
                UPDATE balance_topups
                SET status='failed', payment_id=%s, callback_payload=%s, updated_at=%s
                WHERE id = %s
                """,
                (payment_id, payload_log[:65535], datetime.utcnow(), row["id"]),
            )
            conn.commit()
            return RedirectResponse(_frontend_redirect_url("failed", order_number, error=error or "payment_failed"), status_code=302)


@router.get("/topup/{order_number}")
def topup_status(order_number: str, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute(
                "SELECT order_number, amount_usd, status, payment_id, created_at, updated_at, credited_at FROM balance_topups WHERE user_id=%s AND order_number=%s",
                (user_id, order_number),
            )
            row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Top-up not found.")
    return {
        "order_number": row["order_number"],
        "amount_usd": float(row["amount_usd"]),
        "status": row["status"],
        "payment_id": row["payment_id"],
        "created_at": row["created_at"].isoformat() if hasattr(row["created_at"], "isoformat") else str(row["created_at"]),
        "updated_at": row["updated_at"].isoformat() if hasattr(row["updated_at"], "isoformat") else str(row["updated_at"]),
        "credited_at": row["credited_at"].isoformat() if row.get("credited_at") and hasattr(row["credited_at"], "isoformat") else (str(row["credited_at"]) if row.get("credited_at") else None),
    }
