# Vox Trader Backend - Demo trading (demo_balance + demo_holdings)
from decimal import Decimal
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from typing import Literal
from datetime import datetime
from database import get_db
from routers.auth_router import get_current_user_id
import pymysql
import httpx

router = APIRouter(prefix="/demo", tags=["demo"])
BINANCE_BASE = "https://api.binance.com"

# Default USDT spend for buys (agent)
DEFAULT_BUY_USDT = 100

# Binance spot default commission rate (0.1%)
COMMISSION_RATE = 0.001

# Futures default commission rate (0.04% - close to Binance USDT-M fee)
FUTURES_COMMISSION_RATE = 0.0004


def _get_price(symbol: str) -> float:
    """Fetch current price from Binance (public)."""
    with httpx.Client(timeout=5.0) as client:
        r = client.get(f"{BINANCE_BASE}/api/v3/ticker/price", params={"symbol": symbol.upper()})
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch price")
    return float(r.json()["price"])


def _base_asset(symbol: str) -> str:
    """BTCUSDT -> BTC."""
    s = symbol.upper()
    if s.endswith("USDT"):
        return s[:-4]
    if s.endswith("BUSD"):
        return s[:-4]
    return s


@router.get("/account")
def get_demo_account(user_id: int = Depends(get_current_user_id)):
    """Demo balance and positions."""
    with get_db() as conn:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute("SELECT demo_balance FROM users WHERE id = %s", (user_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="User not found")
            demo_balance = float(row["demo_balance"])
            cur.execute("SELECT asset, quantity FROM demo_holdings WHERE user_id = %s AND quantity > 0", (user_id,))
            holdings = [{"asset": r["asset"], "quantity": float(r["quantity"])} for r in cur.fetchall()]
    return {"demo_balance": demo_balance, "holdings": holdings}


@router.get("/my-trades")
def get_demo_my_trades(
    user_id: int = Depends(get_current_user_id),
    symbol: str = Query("BTCUSDT"),
    limit: int = Query(50, ge=1, le=500),
):
    """Demo trade history (used in demo mode only; does not call Binance)."""
    with get_db() as conn:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute(
                """
                SELECT id, side, symbol, quantity, price_usdt, usdt_amount, commission_usdt, created_at
                FROM demo_trades
                WHERE user_id = %s AND symbol = %s
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (user_id, symbol.upper(), limit),
            )
            rows = cur.fetchall()
    out = []
    for r in rows:
        created = r["created_at"]
        ts = int(created.timestamp() * 1000) if isinstance(created, datetime) else int(datetime.fromisoformat(str(created).replace("Z", "+00:00")).timestamp() * 1000)
        out.append({
            "id": r["id"],
            "orderId": r["id"],
            "symbol": r["symbol"],
            "price": str(r["price_usdt"]),
            "qty": str(r["quantity"]),
            "quoteQty": str(r["usdt_amount"]),
            "commission": str(r.get("commission_usdt") or 0),
            "commissionAsset": "USDT",
            "time": ts,
            "isBuyer": r["side"] == "BUY",
            "isMaker": False,
        })
    return out


INITIAL_DEMO_BALANCE = 10000.0


def _holdings_value(holdings: list[dict]) -> float:
    """USDT value of positions with current market prices."""
    total = 0.0
    for h in holdings:
        asset, qty = h["asset"], float(h["quantity"])
        if asset == "USDT":
            total += qty
            continue
        try:
            price = _get_price(asset + "USDT")
            total += qty * price
        except Exception:
            pass
    return total


@router.get("/performance")
def get_demo_performance(user_id: int = Depends(get_current_user_id)):
    """Agent demo stats: total trades, PnL (realized + unrealized), recent trades, equity curve."""
    with get_db() as conn:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute("SELECT demo_balance FROM users WHERE id = %s", (user_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="User not found")
            # Note: demo_balance is shared by spot + futures.
            # To isolate spot performance from futures, we reconstruct
            # spot cash flow from spot trade history below.
            wallet_balance_actual = float(row["demo_balance"])
            cur.execute("SELECT asset, quantity FROM demo_holdings WHERE user_id = %s AND quantity > 0", (user_id,))
            holdings = [{"asset": r["asset"], "quantity": float(r["quantity"])} for r in cur.fetchall()]
            cur.execute(
                """
                SELECT
                    COUNT(*) AS total_trades,
                    SUM(CASE WHEN side = 'BUY' THEN 1 ELSE 0 END) AS buy_count,
                    SUM(CASE WHEN side = 'SELL' THEN 1 ELSE 0 END) AS sell_count,
                    COALESCE(SUM(commission_usdt), 0) AS total_commission
                FROM demo_trades WHERE user_id = %s
                """,
                (user_id,),
            )
            stats = cur.fetchone()
            cur.execute(
                """
                SELECT side, symbol, quantity, price_usdt, usdt_amount, commission_usdt, source, created_at
                FROM demo_trades WHERE user_id = %s ORDER BY created_at ASC
                """,
                (user_id,),
            )
            rows_asc = cur.fetchall()
            cur.execute(
                """
                SELECT side, symbol, quantity, price_usdt, usdt_amount, commission_usdt, source, created_at
                FROM demo_trades WHERE user_id = %s ORDER BY created_at DESC LIMIT 30
                """,
                (user_id,),
            )
            rows = cur.fetchall()
    total_trades = int(stats["total_trades"] or 0)
    buy_count = int(stats["buy_count"] or 0)
    sell_count = int(stats["sell_count"] or 0)
    total_commission = float(stats.get("total_commission") or 0)

    # Spot cash balance (derived only from demo_trades flow).
    # usdt_amount is negative spend on BUY and net positive credit on SELL (after commission).
    running_balance = INITIAL_DEMO_BALANCE
    running_holdings: dict[str, float] = {}
    equity_curve: list[dict] = [{"t": "Start", "equity": INITIAL_DEMO_BALANCE}]
    price_cache: dict[str, float] = {}
    for r in rows_asc:
        side = r["side"]
        sym = r["symbol"]
        base = _base_asset(sym)
        qty = float(r["quantity"])
        usdt_amt = float(r["usdt_amount"])
        ts = r["created_at"]
        t_str = ts.isoformat() if hasattr(ts, "isoformat") else str(ts)
        if side == "BUY":
            running_balance += usdt_amt
            running_holdings[base] = running_holdings.get(base, 0) + qty
        else:
            running_balance += usdt_amt
            running_holdings[base] = running_holdings.get(base, 0) - qty
            if running_holdings.get(base, 0) <= 0:
                running_holdings.pop(base, None)
        try:
            hv = running_balance
            for a, q in running_holdings.items():
                if a == "USDT":
                    hv += q
                else:
                    key = a + "USDT"
                    if key not in price_cache:
                        price_cache[key] = _get_price(key)
                    hv += q * price_cache[key]
            equity_curve.append({"t": t_str, "equity": round(hv, 2)})
        except Exception:
            equity_curve.append({"t": t_str, "equity": round(running_balance, 2)})
    current_balance = running_balance
    holdings_value = _holdings_value(holdings)
    total_equity = current_balance + holdings_value
    equity_change = total_equity - INITIAL_DEMO_BALANCE
    equity_curve.append({"t": "Now", "equity": round(total_equity, 2)})
    last_trades = [
        {
            "side": r["side"],
            "symbol": r["symbol"],
            "quantity": float(r["quantity"]),
            "price_usdt": float(r["price_usdt"]),
            "usdt_amount": float(r["usdt_amount"]),
            "commission_usdt": float(r.get("commission_usdt") or 0),
            "source": r["source"],
            "created_at": r["created_at"].isoformat() if hasattr(r["created_at"], "isoformat") else str(r["created_at"]),
        }
        for r in rows
    ]
    return {
        "total_trades": total_trades,
        "buy_count": buy_count,
        "sell_count": sell_count,
        "total_commission": total_commission,
        "initial_balance": INITIAL_DEMO_BALANCE,
        "current_balance": round(current_balance, 2),
        "wallet_balance_actual": round(wallet_balance_actual, 2),
        "total_equity": round(total_equity, 2),
        "equity_change": round(equity_change, 2),
        "last_trades": last_trades,
        "equity_curve": equity_curve,
    }


class DemoOrderRequest(BaseModel):
    side: Literal["BUY", "SELL"]
    symbol: str  # BTCUSDT
    quote_order_qty: float | None = None  # USDT amount for BUY (e.g. 100)
    quantity: float | None = None  # Coin amount for SELL; sell all if omitted


def place_demo_order_impl(
    user_id: int,
    side: Literal["BUY", "SELL"],
    symbol: str,
    quote_order_qty: float | None = None,
    quantity: float | None = None,
) -> dict:
    """Demo spot buy/sell (called from agent background with user_id)."""
    symbol = symbol.upper()
    base = _base_asset(symbol)
    price = _get_price(symbol)
    with get_db() as conn:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute("SELECT demo_balance FROM users WHERE id = %s FOR UPDATE", (user_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="User not found")
            demo_balance = Decimal(str(row["demo_balance"]))
            if side == "BUY":
                usdt_spend = Decimal(str(quote_order_qty or DEFAULT_BUY_USDT))
                if usdt_spend <= 0:
                    raise HTTPException(status_code=400, detail="quote_order_qty must be > 0")
                if demo_balance < usdt_spend:
                    raise HTTPException(status_code=400, detail=f"Insufficient demo balance. Current: {float(demo_balance):.2f} USDT")
                commission_usdt = float(usdt_spend) * COMMISSION_RATE
                qty = float(usdt_spend) * (1 - COMMISSION_RATE) / price
                cur.execute("UPDATE users SET demo_balance = demo_balance - %s WHERE id = %s", (float(usdt_spend), user_id))
                cur.execute(
                    "INSERT INTO demo_holdings (user_id, asset, quantity) VALUES (%s, %s, %s) ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)",
                    (user_id, base, qty),
                )
                cur.execute(
                    "INSERT INTO demo_trades (user_id, side, symbol, base_asset, quantity, price_usdt, usdt_amount, commission_usdt, source) VALUES (%s, 'BUY', %s, %s, %s, %s, %s, %s, 'agent')",
                    (user_id, symbol, base, qty, price, -float(usdt_spend), commission_usdt),
                )
                conn.commit()
                return {"ok": True, "message": f"Demo buy: {qty:.8f} {base} (~{float(usdt_spend):.2f} USDT)"}
            if side == "SELL":
                cur.execute("SELECT quantity FROM demo_holdings WHERE user_id = %s AND asset = %s FOR UPDATE", (user_id, base))
                hold = cur.fetchone()
                if not hold or float(hold["quantity"]) <= 0:
                    raise HTTPException(status_code=400, detail=f"You do not have an open {base} position")
                sell_qty = float(quantity) if quantity and quantity > 0 else float(hold["quantity"])
                if sell_qty > float(hold["quantity"]):
                    sell_qty = float(hold["quantity"])
                gross_usdt = sell_qty * price
                commission_usdt = gross_usdt * COMMISSION_RATE
                usdt_credit = gross_usdt - commission_usdt
                cur.execute("UPDATE users SET demo_balance = demo_balance + %s WHERE id = %s", (usdt_credit, user_id))
                cur.execute("UPDATE demo_holdings SET quantity = quantity - %s WHERE user_id = %s AND asset = %s", (sell_qty, user_id, base))
                cur.execute("DELETE FROM demo_holdings WHERE user_id = %s AND quantity <= 0", (user_id,))
                cur.execute(
                    "INSERT INTO demo_trades (user_id, side, symbol, base_asset, quantity, price_usdt, usdt_amount, commission_usdt, source) VALUES (%s, 'SELL', %s, %s, %s, %s, %s, %s, 'agent')",
                    (user_id, symbol, base, sell_qty, price, usdt_credit, commission_usdt),
                )
                conn.commit()
                return {"ok": True, "message": f"Demo sell: {sell_qty:.8f} {base} (~{usdt_credit:.2f} USDT)"}
    raise HTTPException(status_code=400, detail="Invalid side")


@router.post("/order")
def place_demo_order(body: DemoOrderRequest, user_id: int = Depends(get_current_user_id)):
    """Demo buy/sell. BUY spends quote_order_qty USDT. SELL uses quantity or closes all."""
    return place_demo_order_impl(user_id, body.side, body.symbol, body.quote_order_qty, body.quantity)


# --- Demo futures ---

class DemoFuturesOrderRequest(BaseModel):
    side: Literal["LONG", "SHORT"]  # LONG = buy (up), SHORT = sell (down)
    symbol: str  # BTCUSDT
    margin_usdt: float = 100.0  # Margin allocated to position (USDT)
    leverage: int = 10


class DemoFuturesCloseRequest(BaseModel):
    position_id: int  # Position id to close (returned by futures-account)


@router.get("/futures-account")
def get_demo_futures_account(user_id: int = Depends(get_current_user_id)):
    """Demo futures account: available margin and open positions with live unrealized PnL."""
    with get_db() as conn:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute("SELECT demo_balance FROM users WHERE id = %s", (user_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="User not found")
            margin_available = float(row["demo_balance"])
            cur.execute(
                "SELECT id, symbol, side, quantity, entry_price, leverage, margin_used, created_at FROM demo_futures_positions WHERE user_id = %s ORDER BY created_at ASC",
                (user_id,),
            )
            positions_raw = cur.fetchall()
    positions = []
    total_unrealized = 0.0
    for r in positions_raw:
        symbol = r["symbol"]
        side = r["side"]
        qty = float(r["quantity"])
        entry = float(r["entry_price"])
        try:
            current_price = _get_price(symbol)
        except Exception:
            current_price = entry
        if side == "LONG":
            unrealized_pnl = (current_price - entry) * qty
        else:
            unrealized_pnl = (entry - current_price) * qty
        total_unrealized += unrealized_pnl
        positions.append({
            "id": r["id"],
            "symbol": symbol,
            "side": side,
            "quantity": qty,
            "entry_price": entry,
            "leverage": r["leverage"],
            "margin_used": float(r["margin_used"]),
            "current_price": current_price,
            "unrealized_pnl": round(unrealized_pnl, 2),
            "created_at": r["created_at"].isoformat() if hasattr(r["created_at"], "isoformat") else str(r["created_at"]),
        })
    return {"margin_available": margin_available, "positions": positions, "total_unrealized_pnl": round(total_unrealized, 2)}


@router.get("/futures-performance")
def get_demo_futures_performance(user_id: int = Depends(get_current_user_id)):
    """Demo futures performance: margin, open positions, realized/unrealized PnL, commission, and closed trades."""
    with get_db() as conn:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute("SELECT demo_balance FROM users WHERE id = %s", (user_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="User not found")
            margin_available = float(row["demo_balance"])
            cur.execute(
                "SELECT id, symbol, side, quantity, entry_price, leverage, margin_used, created_at FROM demo_futures_positions WHERE user_id = %s ORDER BY created_at ASC",
                (user_id,),
            )
            positions_raw = cur.fetchall()
            cur.execute(
                """
                SELECT COALESCE(SUM(pnl_usdt), 0) AS realized_pnl, COALESCE(SUM(commission_usdt), 0) AS total_commission
                FROM demo_futures_trades WHERE user_id = %s
                """,
                (user_id,),
            )
            agg = cur.fetchone()
            cur.execute(
                """
                SELECT symbol, side, quantity, entry_price, exit_price, pnl_usdt, commission_usdt, created_at
                FROM demo_futures_trades WHERE user_id = %s ORDER BY created_at DESC LIMIT 50
                """,
                (user_id,),
            )
            trades_rows = cur.fetchall()
    realized_pnl = float(agg.get("realized_pnl") or 0)
    total_commission = float(agg.get("total_commission") or 0)
    positions = []
    total_unrealized = 0.0
    total_margin_used = 0.0
    for r in positions_raw:
        symbol = r["symbol"]
        side = r["side"]
        qty = float(r["quantity"])
        entry = float(r["entry_price"])
        margin_used = float(r["margin_used"])
        total_margin_used += margin_used
        try:
            current_price = _get_price(symbol)
        except Exception:
            current_price = entry
        if side == "LONG":
            unrealized_pnl = (current_price - entry) * qty
        else:
            unrealized_pnl = (entry - current_price) * qty
        total_unrealized += unrealized_pnl
        positions.append({
            "id": r["id"],
            "symbol": symbol,
            "side": side,
            "quantity": qty,
            "entry_price": entry,
            "leverage": r["leverage"],
            "margin_used": margin_used,
            "current_price": current_price,
            "unrealized_pnl": round(unrealized_pnl, 2),
            "created_at": r["created_at"].isoformat() if hasattr(r["created_at"], "isoformat") else str(r["created_at"]),
        })
    total_equity = margin_available + total_margin_used + total_unrealized
    equity_change = total_equity - INITIAL_DEMO_BALANCE
    last_trades = [
        {
            "symbol": r["symbol"],
            "side": r["side"],
            "quantity": float(r["quantity"]),
            "entry_price": float(r["entry_price"]),
            "exit_price": float(r["exit_price"]),
            "pnl_usdt": float(r["pnl_usdt"]),
            "commission_usdt": float(r.get("commission_usdt") or 0),
            "created_at": r["created_at"].isoformat() if hasattr(r["created_at"], "isoformat") else str(r["created_at"]),
        }
        for r in trades_rows
    ]
    return {
        "margin_available": round(margin_available, 2),
        "positions": positions,
        "total_unrealized_pnl": round(total_unrealized, 2),
        "realized_pnl": round(realized_pnl, 2),
        "total_commission": round(total_commission, 2),
        "initial_balance": INITIAL_DEMO_BALANCE,
        "total_equity": round(total_equity, 2),
        "equity_change": round(equity_change, 2),
        "last_trades": last_trades,
    }


@router.post("/futures-performance/reset")
def reset_demo_futures_performance(user_id: int = Depends(get_current_user_id)):
    """
    Reset demo futures performance.
    - clears futures position/trade history
    - restores demo_balance to spot-trade cash state
    """
    with get_db() as conn:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            # Spot cash = initial balance + sum(demo_trades.usdt_amount)
            cur.execute(
                "SELECT COALESCE(SUM(usdt_amount), 0) AS spot_cash_flow FROM demo_trades WHERE user_id = %s",
                (user_id,),
            )
            row = cur.fetchone() or {"spot_cash_flow": 0}
            spot_cash = float(INITIAL_DEMO_BALANCE + float(row.get("spot_cash_flow") or 0))
            if spot_cash < 0:
                spot_cash = 0.0

            cur.execute("DELETE FROM demo_futures_positions WHERE user_id = %s", (user_id,))
            cur.execute("DELETE FROM demo_futures_trades WHERE user_id = %s", (user_id,))
            cur.execute("UPDATE users SET demo_balance = %s WHERE id = %s", (round(spot_cash, 2), user_id))
            conn.commit()
    return {"ok": True, "message": "Futures performance reset.", "demo_balance": round(spot_cash, 2)}


def place_demo_futures_order_impl(
    user_id: int,
    side: Literal["LONG", "SHORT"],
    symbol: str,
    margin_usdt: float = 100.0,
    leverage: int = 10,
) -> dict:
    """Demo futures trade (called from agent background with user_id)."""
    symbol = symbol.upper()
    margin_usdt = Decimal(str(max(1, min(10000, margin_usdt))))
    leverage = max(1, min(125, leverage))
    price = _get_price(symbol)
    opposite_side = "SHORT" if side == "LONG" else "LONG"
    with get_db() as conn:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute("SELECT demo_balance FROM users WHERE id = %s FOR UPDATE", (user_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="User not found")
            demo_balance = Decimal(str(row["demo_balance"]))
            cur.execute(
                "SELECT id, side, quantity, entry_price, margin_used FROM demo_futures_positions WHERE user_id = %s AND symbol = %s AND side = %s FOR UPDATE",
                (user_id, symbol, opposite_side),
            )
            for pos in cur.fetchall():
                ex_side = pos["side"]
                ex_qty = float(pos["quantity"])
                ex_price = float(pos["entry_price"])
                ex_margin = float(pos["margin_used"])
                pnl = (price - ex_price) * ex_qty if ex_side == "LONG" else (ex_price - price) * ex_qty
                notional_close = ex_qty * price
                commission = notional_close * FUTURES_COMMISSION_RATE
                settlement = ex_margin + pnl - commission
                cur.execute("DELETE FROM demo_futures_positions WHERE id = %s AND user_id = %s", (pos["id"], user_id))
                cur.execute("UPDATE users SET demo_balance = demo_balance + %s WHERE id = %s", (float(settlement), user_id))
                cur.execute(
                    "INSERT INTO demo_futures_trades (user_id, symbol, side, quantity, entry_price, exit_price, pnl_usdt, commission_usdt) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                    (user_id, symbol, ex_side, ex_qty, ex_price, price, pnl, commission),
                )
            conn.commit()
            cur.execute("SELECT demo_balance FROM users WHERE id = %s FOR UPDATE", (user_id,))
            row = cur.fetchone()
            demo_balance = Decimal(str(row["demo_balance"]))
            if demo_balance < margin_usdt:
                raise HTTPException(status_code=400, detail=f"Insufficient margin. Current: {float(demo_balance):.2f} USDT")
            notional = float(margin_usdt) * leverage
            qty = notional / price
            cur.execute("UPDATE users SET demo_balance = demo_balance - %s WHERE id = %s", (float(margin_usdt), user_id))
            cur.execute(
                "INSERT INTO demo_futures_positions (user_id, symbol, side, quantity, entry_price, leverage, margin_used) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (user_id, symbol, side, qty, price, leverage, float(margin_usdt)),
            )
            conn.commit()
    return {"ok": True, "message": f"Demo {side}: {qty:.8f} {symbol} @ {price:.2f}, {leverage}x"}


@router.post("/futures-order")
def place_demo_futures_order(body: DemoFuturesOrderRequest, user_id: int = Depends(get_current_user_id)):
    """Demo futures trade: open LONG or SHORT. Opposite positions on same symbol are closed first. Commission 0.04%."""
    return place_demo_futures_order_impl(user_id, body.side, body.symbol, body.margin_usdt, body.leverage)


@router.get("/futures-trades")
def get_demo_futures_trades(
    user_id: int = Depends(get_current_user_id),
    limit: int = Query(50, ge=1, le=200),
):
    """Closed demo futures trades (history)."""
    with get_db() as conn:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute(
                """
                SELECT symbol, side, quantity, entry_price, exit_price, pnl_usdt, commission_usdt, created_at
                FROM demo_futures_trades WHERE user_id = %s ORDER BY created_at DESC LIMIT %s
                """,
                (user_id, limit),
            )
            rows = cur.fetchall()
    return [
        {
            "symbol": r["symbol"],
            "side": r["side"],
            "quantity": float(r["quantity"]),
            "entry_price": float(r["entry_price"]),
            "exit_price": float(r["exit_price"]),
            "pnl_usdt": float(r["pnl_usdt"]),
            "commission_usdt": float(r.get("commission_usdt") or 0),
            "created_at": r["created_at"].isoformat() if hasattr(r["created_at"], "isoformat") else str(r["created_at"]),
        }
        for r in rows
    ]


@router.post("/futures-close")
def close_demo_futures_position(body: DemoFuturesCloseRequest, user_id: int = Depends(get_current_user_id)):
    """Close an open demo futures position. Computes PnL at market price and credits margin + PnL - commission."""
    with get_db() as conn:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute(
                "SELECT id, symbol, side, quantity, entry_price, margin_used FROM demo_futures_positions WHERE id = %s AND user_id = %s FOR UPDATE",
                (body.position_id, user_id),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Position not found or does not belong to you")
            symbol = row["symbol"]
            side = row["side"]
            qty = float(row["quantity"])
            entry_price = float(row["entry_price"])
            margin_used = float(row["margin_used"])
            try:
                exit_price = _get_price(symbol)
            except Exception:
                raise HTTPException(status_code=502, detail="Failed to fetch price")
            if side == "LONG":
                pnl = (exit_price - entry_price) * qty
            else:
                pnl = (entry_price - exit_price) * qty
            notional = qty * exit_price
            commission = notional * FUTURES_COMMISSION_RATE
            settlement = margin_used + pnl - commission
            cur.execute("DELETE FROM demo_futures_positions WHERE id = %s AND user_id = %s", (body.position_id, user_id))
            cur.execute(
                "UPDATE users SET demo_balance = demo_balance + %s WHERE id = %s",
                (float(settlement), user_id),
            )
            cur.execute(
                """
                INSERT INTO demo_futures_trades (user_id, symbol, side, quantity, entry_price, exit_price, pnl_usdt, commission_usdt)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (user_id, symbol, side, qty, entry_price, exit_price, pnl, commission),
            )
            conn.commit()
    return {
        "ok": True,
        "message": f"Position closed. PnL: {pnl:+.2f} USDT, commission: {commission:.2f} USDT",
        "pnl_usdt": round(pnl, 2),
        "commission_usdt": round(commission, 2),
    }
