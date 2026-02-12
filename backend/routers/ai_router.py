# Vox Trader Backend - Z.AI GLM + OpenAI chat + agent (balance, model selection, token usage logging)
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Literal, Optional
import asyncio
import httpx
import re
import time
import threading
from datetime import datetime, timedelta
from config import get_settings
from routers.auth_router import get_current_user_id
from database import get_db
import pymysql

router = APIRouter(prefix="/ai", tags=["ai"])

# Model registry: provider, prices in USD per 1M tokens. (input, cached_input, output)
MODEL_REGISTRY: dict[str, dict] = {
    "GLM-4.6V-Flash": {"provider": "glm", "input": 0, "cached": 0, "output": 0},
    "GLM-4.6V": {"provider": "glm", "input": 0.3, "cached": 0.05, "output": 0.9},
    "GLM-OCR": {"provider": "glm", "input": 0.03, "cached": 0, "output": 0.03},
    "GLM-4.6V-FlashX": {"provider": "glm", "input": 0.04, "cached": 0.004, "output": 0.4},
    "GLM-4.5V": {"provider": "glm", "input": 0.6, "cached": 0.11, "output": 1.8},
    "gpt-5.2": {"provider": "openai", "input": 1.75, "cached": 0.175, "output": 14.0},
    "gpt-5.1": {"provider": "openai", "input": 1.25, "cached": 0.125, "output": 10.0},
    "gpt-5": {"provider": "openai", "input": 1.25, "cached": 0.125, "output": 10.0},
    "gpt-5-mini": {"provider": "openai", "input": 0.25, "cached": 0.025, "output": 2.0},
    "gpt-5-nano": {"provider": "openai", "input": 0.05, "cached": 0.005, "output": 0.4},
}
DEFAULT_AGENT_MODEL = "GLM-4.6V-Flash"
DEFAULT_CHAT_MODEL = "GLM-4.6V-Flash"


def _get_balance(user_id: int) -> float:
    with get_db() as conn:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute("SELECT balance FROM users WHERE id = %s", (user_id,))
            row = cur.fetchone()
    return float(row["balance"]) if row else 0.0


def _deduct_balance(user_id: int, cost_usd: float, conn=None) -> bool:
    """Deduct from balance using existing or new DB connection. Returns True for cost_usd <= 0."""
    if cost_usd <= 0:
        return True
    if conn is not None:
        with conn.cursor() as cur:
            cur.execute("SELECT balance FROM users WHERE id = %s FOR UPDATE", (user_id,))
            row = cur.fetchone()
            if not row or float(row[0]) < cost_usd:
                return False
            cur.execute("UPDATE users SET balance = balance - %s WHERE id = %s", (cost_usd, user_id))
        return True
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT balance FROM users WHERE id = %s FOR UPDATE", (user_id,))
            row = cur.fetchone()
            if not row or float(row[0]) < cost_usd:
                return False
            cur.execute("UPDATE users SET balance = balance - %s WHERE id = %s", (cost_usd, user_id))
            conn.commit()
    return True


def _compute_cost(model_id: str, input_tokens: int, output_tokens: int, cached_input_tokens: int = 0) -> float:
    info = MODEL_REGISTRY.get(model_id, MODEL_REGISTRY.get(DEFAULT_AGENT_MODEL, {"input": 0, "cached": 0, "output": 0}))
    inp = info.get("input", 0) or 0
    cached = info.get("cached", 0) or 0
    out = info.get("output", 0) or 0
    return (input_tokens / 1_000_000) * inp + (cached_input_tokens / 1_000_000) * cached + (output_tokens / 1_000_000) * out


def _append_agent_log(user_id: int, message: str, log_type: str = "log", analysis_id: int | None = None) -> None:
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO agent_log (user_id, message, analysis_id, log_type) VALUES (%s, %s, %s, %s)",
                (user_id, (message or "")[:500], analysis_id, log_type),
            )
            conn.commit()


# Background agent runner (keeps running even if page is closed)
_agent_runner_thread: threading.Thread | None = None
_agent_runner_stop = threading.Event()


def _get_demo_portfolio_context(user_id: int) -> str:
    """Return user demo balance and positions (amount + average entry) as text context for agent decisions."""
    try:
        with get_db() as conn:
            with conn.cursor(pymysql.cursors.DictCursor) as cur:
                cur.execute("SELECT demo_balance FROM users WHERE id = %s", (user_id,))
                row = cur.fetchone()
                if not row:
                    return ""
                demo_balance = float(row["demo_balance"])
                cur.execute(
                    "SELECT asset, quantity FROM demo_holdings WHERE user_id = %s AND quantity > 0",
                    (user_id,),
                )
                holdings = [{"asset": r["asset"], "quantity": float(r["quantity"])} for r in cur.fetchall()]
        if not holdings:
            return f"Current demo balance: {demo_balance:.2f} USDT. No open positions (USDT only)."
        lines = [f"Current demo balance: {demo_balance:.2f} USDT."]
        for h in holdings:
            asset, qty = h["asset"], h["quantity"]
            if asset == "USDT":
                continue
            symbol = asset + "USDT"
            with get_db() as conn:
                with conn.cursor(pymysql.cursors.DictCursor) as cur:
                    cur.execute(
                        """
                        SELECT quantity, price_usdt FROM demo_trades
                        WHERE user_id = %s AND symbol = %s AND side = 'BUY'
                        ORDER BY created_at ASC
                        """,
                        (user_id, symbol),
                    )
                    buys = cur.fetchall()
            if buys:
                total_qty = sum(float(b["quantity"]) for b in buys)
                total_cost = sum(float(b["quantity"]) * float(b["price_usdt"]) for b in buys)
                avg_cost = total_cost / total_qty if total_qty else 0
                lines.append(
                    f"Position: {symbol} — {qty:.8f} units (average buy ~{avg_cost:.2f} USDT)."
                )
            else:
                lines.append(f"Position: {symbol} — {qty:.8f} units.")
        return " ".join(lines)
    except Exception:
        return ""


def _get_demo_futures_context(user_id: int) -> str:
    """Return user demo futures positions as text context."""
    try:
        with get_db() as conn:
            with conn.cursor(pymysql.cursors.DictCursor) as cur:
                cur.execute("SELECT demo_balance FROM users WHERE id = %s", (user_id,))
                row = cur.fetchone()
                if not row:
                    return ""
                margin_available = float(row["demo_balance"])
                cur.execute(
                    "SELECT symbol, side, quantity, entry_price, leverage, margin_used FROM demo_futures_positions WHERE user_id = %s",
                    (user_id,),
                )
                positions = cur.fetchall()
        if not positions:
            return f"Available margin: {margin_available:.2f} USDT. No open leveraged positions."
        lines = [f"Available margin: {margin_available:.2f} USDT."]
        for p in positions:
            lines.append(
                f"Position: {p['symbol']} {p['side']} — {float(p['quantity']):.8f} units, entry ~{float(p['entry_price']):.2f} USDT, {p['leverage']}x leverage, margin {float(p['margin_used']):.2f} USDT."
            )
        return " ".join(lines)
    except Exception:
        return ""


SYSTEM_PROMPT = """You are Vox Trader's AI assistant powered by GLM-4.6V-Flash.
Provide short and clear answers about crypto markets, trading, portfolio management, and technical analysis.
Reply in English. This is informational only, not financial advice."""

# Agent strategy texts (for chart analysis)
AGENT_STRATEGIES = {
    "agresif": """Strategy: AGGRESSIVE (short-term, high frequency).
Look for short-term opportunities on the chart. Suggest buy/sell more often. Keep stop-loss tight. Focus on scalping and intraday trades.""",
    "pasif": """Strategy: PASSIVE (low risk).
Suggest actions only on strong signals. Fewer trades, wider stop-loss. Prioritize protection.""",
    "uzun_vade": """Strategy: LONG-TERM (swing/position).
Focus on weekly/monthly trends. Ignore short-term noise. Prefer buy-and-hold or sell-and-hold style suggestions.""",
    "kisa_vade": """Strategy: SHORT-TERM (daily/intraday).
Focus on intraday movements. Keep entry/exit levels clear. Pay attention to technical patterns.""",
}


class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    model: str = DEFAULT_CHAT_MODEL


class ChatResponse(BaseModel):
    content: str


# --- Agent (chart analysis + buy/sell suggestion) ---

class AgentAnalyzeRequest(BaseModel):
    image_base64: Optional[str] = None  # data:image/png;base64,... veya sadece base64
    symbol: str = "BTCUSDT"
    interval: str = "1m"
    strategy: Literal["agresif", "pasif", "uzun_vade", "kisa_vade"] = "kisa_vade"
    custom_prompt: str = ""
    market_type: Literal["spot", "futures"] = "spot"
    model: str = DEFAULT_AGENT_MODEL


class AgentAnalyzeResponse(BaseModel):
    analysis: str
    action: Literal["BUY", "SELL", "HOLD"]
    buy_at: Optional[float] = None
    sell_at: Optional[float] = None
    message: str
    analysis_id: Optional[int] = None


def _parse_agent_response(content: str) -> AgentAnalyzeResponse:
    """Extract action and price levels from model response."""
    content_upper = content.upper()
    action = "HOLD"
    if "BUY" in content_upper:
        action = "BUY"
    elif "SELL" in content_upper:
        action = "SELL"

    buy_at = None
    sell_at = None
    # Price examples: 95.200, 95200, 95,200
    for match in re.finditer(r"(\d+[.,]?\d*)\s*(?:buy(?:\s*at)?|buy\s*price|buy\s*@)", content, re.I):
        try:
            buy_at = float(match.group(1).replace(",", "."))
            break
        except ValueError:
            pass
    for match in re.finditer(r"(\d+[.,]?\d*)\s*(?:sell(?:\s*at)?|sell\s*price|sell\s*@)", content, re.I):
        try:
            sell_at = float(match.group(1).replace(",", "."))
            break
        except ValueError:
            pass
    # Generic number patterns
    if buy_at is None:
        for m in re.finditer(r"(?:buy)\s*(?:price)?\s*[:\s]*(\d+[.,]\d+)", content, re.I):
            try:
                buy_at = float(m.group(1).replace(",", "."))
                break
            except ValueError:
                pass
    if sell_at is None:
        for m in re.finditer(r"(?:sell)\s*(?:price)?\s*[:\s]*(\d+[.,]\d+)", content, re.I):
            try:
                sell_at = float(m.group(1).replace(",", "."))
                break
            except ValueError:
                pass

    return AgentAnalyzeResponse(
        analysis=content[:2000],
        action=action,
        buy_at=buy_at,
        sell_at=sell_at,
        message=content[:500],
        analysis_id=None,
    )


def _analyze_with_image_sync(
    user_id: int,
    image_base64: str,
    symbol: str,
    interval: str,
    strategy: str,
    custom_prompt: str,
    market_type: str,
    model_id: str = DEFAULT_AGENT_MODEL,
) -> tuple[str, int | None]:
    """Send sync request with image + context to selected model (GLM/OpenAI), return action and analysis_id, deduct balance, and log usage."""
    s = get_settings()
    model_info = MODEL_REGISTRY.get(model_id) or MODEL_REGISTRY.get(DEFAULT_AGENT_MODEL)
    provider = model_info.get("provider", "glm")
    is_futures = market_type == "futures"
    portfolio_ctx = _get_demo_futures_context(user_id) if is_futures else _get_demo_portfolio_context(user_id)
    strategy_text = AGENT_STRATEGIES.get(strategy, AGENT_STRATEGIES["kisa_vade"])
    user_content = ""
    if portfolio_ctx:
        user_content += f"[User's current demo status: {portfolio_ctx}]\n\n"
    user_content += (
        f"Currently analyzed: {symbol}, timeframe: {interval}. Market: {'Futures (leveraged)' if is_futures else 'Spot'}.\n"
        f"{strategy_text}\n\n"
    )
    if is_futures:
        user_content += (
            "This is a FUTURES (leveraged) analysis: LONG = buy, SHORT = sell. If there is an open position, evaluate profit/loss vs entry price. "
        )
    if (custom_prompt or "").strip():
        user_content += f"User instruction: {(custom_prompt or '').strip()}\n\n"
    user_content += (
        "Review the chart image and provide a short technical analysis. Suggest BUY, SELL, or HOLD. Reply in English."
    )
    has_image = bool(image_base64 and image_base64.strip())
    if has_image:
        b64 = image_base64.strip()
        url = b64 if b64.startswith("data:") else f"data:image/png;base64,{b64}"
        user_msg = [{"type": "text", "text": user_content}, {"type": "image_url", "image_url": {"url": url}}]
    else:
        user_msg = user_content
    system_content = (
        "You are a crypto chart analyst and trading assistant. Suggest BUY, SELL, or HOLD. In futures mode BUY=long and SELL=short. Keep it concise."
    )
    content = ""
    usage = {"input_tokens": 0, "output_tokens": 0, "cached_input_tokens": 0}

    if provider == "openai":
        if not getattr(s, "OPENAI_API_KEY", None) or not s.OPENAI_API_KEY:
            return ("HOLD", None)
        payload = {
            "model": model_id,
            "messages": [{"role": "system", "content": system_content}, {"role": "user", "content": user_msg}],
            "max_tokens": 4096,
            "temperature": 0.6,
        }
        base = (getattr(s, "OPENAI_BASE_URL", None) or "https://api.openai.com/v1").strip().rstrip("/")
        url = f"{base}/chat/completions"
        try:
            with httpx.Client(timeout=httpx.Timeout(30.0, read=180.0)) as client:
                r = client.post(
                    url,
                    headers={"Content-Type": "application/json", "Authorization": f"Bearer {s.OPENAI_API_KEY}"},
                    json=payload,
                )
            if r.status_code != 200:
                return ("HOLD", None)
            data = r.json()
            content = (data.get("choices") or [{}])[0].get("message", {}).get("content") or ""
            u = data.get("usage") or {}
            usage["input_tokens"] = u.get("prompt_tokens") or 0
            usage["output_tokens"] = u.get("completion_tokens") or 0
            usage["cached_input_tokens"] = u.get("prompt_tokens_details", {}).get("cached_tokens") or 0
        except Exception:
            return ("HOLD", None)
    else:
        if not s.GLM5_API_KEY:
            return ("HOLD", None)
        use_vision = has_image and (model_id != "GLM-4.6V-Flash" or bool((s.GLM_VISION_MODEL or "").strip()))
        if has_image and not use_vision and model_id == "GLM-4.6V-Flash":
            user_msg = user_content
        payload = {
            "model": model_id if model_id in MODEL_REGISTRY else (s.GLM_VISION_MODEL or "GLM-4.6V-Flash"),
            "messages": [{"role": "system", "content": system_content}, {"role": "user", "content": user_msg}],
            "max_tokens": 4096,
            "temperature": 0.6,
        }
        if getattr(s, "GLM5_THINKING", True):
            payload["thinking"] = {"type": "enabled"}
        try:
            with httpx.Client(timeout=httpx.Timeout(30.0, read=180.0)) as client:
                r = client.post(
                    f"{s.GLM5_BASE_URL.rstrip('/')}/chat/completions",
                    headers={"Content-Type": "application/json", "Authorization": f"Bearer {s.GLM5_API_KEY}"},
                    json=payload,
                )
            if r.status_code != 200:
                return ("HOLD", None)
            data = r.json()
            content = data.get("choices", [{}])[0].get("message", {}).get("content") or ""
            u = data.get("usage") or {}
            usage["input_tokens"] = u.get("prompt_tokens") or 0
            usage["output_tokens"] = u.get("completion_tokens") or 0
            usage["cached_input_tokens"] = u.get("input_tokens_details", {}).get("cached_tokens") or 0
        except Exception:
            return ("HOLD", None)

    cost = _compute_cost(
        model_id,
        usage["input_tokens"],
        usage["output_tokens"],
        usage["cached_input_tokens"],
    )
    balance = _get_balance(user_id)
    if cost > 0 and balance < cost:
        return ("HOLD", None)
    parsed = _parse_agent_response(content)
    try:
        with get_db() as conn:
            if cost > 0:
                if not _deduct_balance(user_id, cost, conn):
                    return (parsed.action, None)
            with conn.cursor(pymysql.cursors.DictCursor) as cur:
                cur.execute(
                    """INSERT INTO agent_analyses (user_id, symbol, `interval`, strategy, action, analysis_text, message_short, buy_at, sell_at, market_type, model, input_tokens, output_tokens, cached_input_tokens, cost_usd)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (
                        user_id, symbol, interval, strategy, parsed.action, content[:65535], (parsed.message or "")[:500],
                        parsed.buy_at, parsed.sell_at, market_type, model_id,
                        usage["input_tokens"], usage["output_tokens"], usage["cached_input_tokens"], cost,
                    ),
                )
                conn.commit()
                aid = cur.lastrowid
        return (parsed.action, aid)
    except Exception:
        return (parsed.action, None)


def _run_agent_cycle_sync(user_id: int) -> None:
    """Single agent cycle for one user: render chart, analyze, log output, and place order if enabled."""
    from services.chart_render import fetch_klines, render_candlestick_base64
    from routers.demo_router import place_demo_order_impl, place_demo_futures_order_impl

    with get_db() as conn:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute(
                "SELECT is_running, symbol, `interval`, strategy, custom_prompt, market_type, trade_enabled, order_amount, order_amount_mode, max_open_positions, single_trade_if_max, max_mode_used, min_trade_interval_sec, leverage, interval_sec, model FROM agent_job WHERE user_id = %s",
                (user_id,),
            )
            job = cur.fetchone()
    if not job or not job["is_running"]:
        return
    symbol = (job["symbol"] or "BTCUSDT").upper()
    interval = job["interval"] or "1m"
    model_id = (job.get("model") or DEFAULT_AGENT_MODEL).strip() or DEFAULT_AGENT_MODEL
    try:
        klines = fetch_klines(symbol, interval, 100)
        image_b64 = render_candlestick_base64(klines, symbol)
    except Exception as e:
        reason = getattr(e, "detail", None) or str(e) or e.__class__.__name__
        _append_agent_log(user_id, f"Failed to fetch chart: {reason}", "log")
        return
    _append_agent_log(user_id, f"AI request sent ({symbol} / {interval}, {model_id}).", "log")
    action, analysis_id = _analyze_with_image_sync(
        user_id, image_b64, symbol, interval,
        job["strategy"] or "kisa_vade", (job["custom_prompt"] or "") or "", job["market_type"] or "spot",
        model_id=model_id,
    )
    if analysis_id is None:
        msg = "AI response could not be retrieved."
    else:
        msg = "Suggestion: Hold" if action == "HOLD" else ("Suggestion: Buy" if action == "BUY" else "Suggestion: Sell")
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO agent_log (user_id, message, analysis_id, log_type) VALUES (%s, %s, %s, %s)", (user_id, msg, analysis_id, "result"))
            cur.execute("UPDATE agent_job SET last_run_at = %s WHERE user_id = %s", (datetime.utcnow(), user_id))
            conn.commit()
    if not job["trade_enabled"] and action in ("BUY", "SELL"):
        _append_agent_log(user_id, "Trading mode is off: order not sent.", "log")
        return
    if job["trade_enabled"] and action in ("BUY", "SELL"):
        try:
            market_type = (job["market_type"] or "spot")
            order_mode = (job.get("order_amount_mode") or "fixed").lower()
            if order_mode not in ("fixed", "max"):
                order_mode = "fixed"
            max_open_positions = max(1, min(50, int(job.get("max_open_positions") or 1)))
            min_trade_interval_sec = max(0, min(86400, int(job.get("min_trade_interval_sec") or 0)))
            single_trade_if_max = bool(job.get("single_trade_if_max"))
            max_mode_used = bool(job.get("max_mode_used"))
            target_futures_side = "LONG" if action == "BUY" else "SHORT"

            if order_mode == "max" and single_trade_if_max and max_mode_used:
                _append_agent_log(user_id, "Maximum mode single-trade rule: no new order was sent.", "log")
                return

            amount_to_use = float(job["order_amount"] or 100)
            if market_type == "futures":
                with get_db() as conn:
                    with conn.cursor(pymysql.cursors.DictCursor) as cur:
                        cur.execute(
                            "SELECT COUNT(*) AS c FROM demo_futures_positions WHERE user_id = %s AND symbol = %s AND side = %s",
                            (user_id, symbol, target_futures_side),
                        )
                        same_side_count = int((cur.fetchone() or {}).get("c") or 0)
                        if same_side_count >= max_open_positions:
                            _append_agent_log(user_id, f"Limit: maximum open {target_futures_side} positions ({max_open_positions}) reached.", "log")
                            return
                        if min_trade_interval_sec > 0:
                            cur.execute(
                                "SELECT created_at FROM demo_futures_positions WHERE user_id = %s AND symbol = %s AND side = %s ORDER BY created_at DESC LIMIT 1",
                                (user_id, symbol, target_futures_side),
                            )
                            last_same_side = cur.fetchone()
                            if last_same_side and last_same_side.get("created_at"):
                                dt = last_same_side["created_at"]
                                if hasattr(dt, "timestamp"):
                                    diff = int(time.time() - float(dt.timestamp()))
                                    if diff < min_trade_interval_sec:
                                        _append_agent_log(
                                            user_id,
                                            f"Limit: waiting {max(0, min_trade_interval_sec - diff)}s before a new order in the same direction.",
                                            "log",
                                        )
                                        return
                        if order_mode == "max":
                            cur.execute("SELECT demo_balance FROM users WHERE id = %s", (user_id,))
                            bal_row = cur.fetchone() or {}
                            balance_now = float(bal_row.get("demo_balance") or 0)
                            if balance_now <= 0:
                                _append_agent_log(user_id, "Maximum mode: no available balance.", "log")
                                return
                            amount_to_use = balance_now
                place_demo_futures_order_impl(
                    user_id, target_futures_side, symbol,
                    amount_to_use, int(job["leverage"] or 10),
                )
            else:
                if order_mode == "max" and action == "BUY":
                    with get_db() as conn:
                        with conn.cursor(pymysql.cursors.DictCursor) as cur:
                            cur.execute("SELECT demo_balance FROM users WHERE id = %s", (user_id,))
                            bal_row = cur.fetchone() or {}
                            balance_now = float(bal_row.get("demo_balance") or 0)
                            if balance_now <= 0:
                                _append_agent_log(user_id, "Maximum mode: no available balance.", "log")
                                return
                            amount_to_use = balance_now
                if action == "BUY":
                    place_demo_order_impl(user_id, action, symbol, quote_order_qty=amount_to_use)
                else:
                    place_demo_order_impl(user_id, action, symbol)
            if order_mode == "max" and single_trade_if_max:
                with get_db() as conn:
                    with conn.cursor() as cur:
                        cur.execute("UPDATE agent_job SET max_mode_used = 1 WHERE user_id = %s", (user_id,))
                        conn.commit()
            _append_agent_log(
                user_id,
                f"Trade executed: {target_futures_side if market_type == 'futures' else action}",
                "log",
            )
        except Exception as e:
            reason = getattr(e, "detail", None) or str(e) or e.__class__.__name__
            _append_agent_log(user_id, f"Trade failed: {reason}", "log")


def _agent_runner_loop() -> None:
    while not _agent_runner_stop.is_set():
        try:
            now = datetime.utcnow()
            with get_db() as conn:
                with conn.cursor(pymysql.cursors.DictCursor) as cur:
                    cur.execute(
                        """SELECT user_id, interval_sec, last_run_at FROM agent_job WHERE is_running = 1"""
                    )
                    jobs = cur.fetchall()
            for j in jobs:
                uid = j["user_id"]
                sec = int(j["interval_sec"] or 60)
                last = j["last_run_at"]
                if last is None or (now - last).total_seconds() >= sec:
                    try:
                        _run_agent_cycle_sync(uid)
                    except Exception:
                        pass
        except Exception:
            pass
        _agent_runner_stop.wait(timeout=5)


def start_agent_runner() -> None:
    global _agent_runner_thread
    if _agent_runner_thread is not None and _agent_runner_thread.is_alive():
        return
    _agent_runner_stop.clear()
    _agent_runner_thread = threading.Thread(target=_agent_runner_loop, daemon=True)
    _agent_runner_thread.start()


@router.post("/agent/analyze", response_model=AgentAnalyzeResponse)
async def agent_analyze(
    body: AgentAnalyzeRequest,
    user_id: int = Depends(get_current_user_id),
):
    """Analyze chart screenshot and context; returns buy/sell/hold suggestion and deducts balance."""
    model_id = (body.model or DEFAULT_AGENT_MODEL).strip() or DEFAULT_AGENT_MODEL
    if model_id not in MODEL_REGISTRY:
        model_id = DEFAULT_AGENT_MODEL
    action, analysis_id = await asyncio.to_thread(
        _analyze_with_image_sync,
        user_id,
        body.image_base64 or "",
        body.symbol,
        body.interval,
        body.strategy,
        body.custom_prompt or "",
        body.market_type,
        model_id,
    )
    content = ""
    message_short = ""
    buy_at = None
    sell_at = None
    if analysis_id:
        with get_db() as conn:
            with conn.cursor(pymysql.cursors.DictCursor) as cur:
                cur.execute(
                    "SELECT analysis_text, message_short, buy_at, sell_at FROM agent_analyses WHERE id = %s AND user_id = %s",
                    (analysis_id, user_id),
                )
                row = cur.fetchone()
                if row:
                    content = row["analysis_text"] or ""
                    message_short = row["message_short"] or ""
                    buy_at = float(row["buy_at"]) if row["buy_at"] is not None else None
                    sell_at = float(row["sell_at"]) if row["sell_at"] is not None else None
    return AgentAnalyzeResponse(
        analysis=content[:2000],
        action=action,
        buy_at=buy_at,
        sell_at=sell_at,
        message=message_short or content[:500],
        analysis_id=analysis_id,
    )


@router.get("/agent/analyses/{analysis_id}")
async def get_agent_analysis(
    analysis_id: int,
    user_id: int = Depends(get_current_user_id),
):
    """Return full text for a saved agent analysis (opened from output list)."""
    with get_db() as conn:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute(
                "SELECT id, symbol, `interval`, strategy, action, analysis_text, message_short, buy_at, sell_at, created_at FROM agent_analyses WHERE id = %s AND user_id = %s",
                (analysis_id, user_id),
            )
            row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Analysis not found.")
    return {
        "id": row["id"],
        "symbol": row["symbol"],
        "interval": row["interval"],
        "strategy": row["strategy"],
        "action": row["action"],
        "analysis_text": row["analysis_text"],
        "message_short": row["message_short"],
        "buy_at": float(row["buy_at"]) if row["buy_at"] is not None else None,
        "sell_at": float(row["sell_at"]) if row["sell_at"] is not None else None,
        "created_at": row["created_at"].isoformat() if hasattr(row["created_at"], "isoformat") else str(row["created_at"]),
    }


class AgentStartRequest(BaseModel):
    symbol: str = "BTCUSDT"
    interval: str = "1m"
    strategy: Literal["agresif", "pasif", "uzun_vade", "kisa_vade"] = "kisa_vade"
    custom_prompt: str = ""
    market_type: Literal["spot", "futures"] = "spot"
    trade_enabled: bool = False
    order_amount: float = 100.0
    order_amount_mode: Literal["fixed", "max"] = "fixed"
    max_open_positions: int = 1
    single_trade_if_max: bool = True
    min_trade_interval_sec: int = 0
    leverage: int = 10
    interval_sec: int = 60
    model: str = DEFAULT_AGENT_MODEL


@router.get("/balance")
def get_balance(user_id: int = Depends(get_current_user_id)):
    """User AI balance (USD)."""
    return {"balance": _get_balance(user_id)}


@router.get("/models")
def list_models():
    """Selectable models (for agent and chat)."""
    return {"models": [{"id": k, "label": k, "provider": v["provider"]} for k, v in MODEL_REGISTRY.items()]}


@router.post("/agent/start")
def agent_start(body: AgentStartRequest, user_id: int = Depends(get_current_user_id)):
    """Start agent in background. Keeps running even when page is closed."""
    start_agent_runner()
    model_id = (body.model or DEFAULT_AGENT_MODEL).strip() or DEFAULT_AGENT_MODEL
    if model_id not in MODEL_REGISTRY:
        model_id = DEFAULT_AGENT_MODEL
    order_mode = (body.order_amount_mode or "fixed").strip().lower()
    if order_mode not in ("fixed", "max"):
        order_mode = "fixed"
    max_open_positions = max(1, min(50, int(body.max_open_positions or 1)))
    min_trade_interval_sec = max(0, min(86400, int(body.min_trade_interval_sec or 0)))
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO agent_job (user_id, is_running, symbol, `interval`, strategy, custom_prompt, market_type, trade_enabled, order_amount, order_amount_mode, max_open_positions, single_trade_if_max, max_mode_used, min_trade_interval_sec, leverage, interval_sec, model, started_at, last_run_at)
                VALUES (%s, 1, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 0, %s, %s, %s, %s, %s, NULL)
                ON DUPLICATE KEY UPDATE is_running=1, symbol=VALUES(symbol), `interval`=VALUES(`interval`), strategy=VALUES(strategy), custom_prompt=VALUES(custom_prompt),
                market_type=VALUES(market_type), trade_enabled=VALUES(trade_enabled), order_amount=VALUES(order_amount), order_amount_mode=VALUES(order_amount_mode),
                max_open_positions=VALUES(max_open_positions), single_trade_if_max=VALUES(single_trade_if_max), max_mode_used=0, min_trade_interval_sec=VALUES(min_trade_interval_sec),
                leverage=VALUES(leverage), interval_sec=VALUES(interval_sec), model=VALUES(model), started_at=VALUES(started_at)""",
                (
                    user_id, body.symbol.upper(), body.interval, body.strategy, body.custom_prompt or "",
                    body.market_type, 1 if body.trade_enabled else 0, body.order_amount, order_mode, max_open_positions,
                    1 if body.single_trade_if_max else 0, min_trade_interval_sec,
                    body.leverage, max(5, min(3600, body.interval_sec)), model_id, datetime.utcnow(),
                ),
            )
            conn.commit()
            cur.execute("INSERT INTO agent_log (user_id, message, log_type) VALUES (%s, %s, %s)", (user_id, "Agent started in background.", "log"))
            conn.commit()
    return {"ok": True, "message": "Agent started in background. It continues running even if you leave the page."}


@router.post("/agent/stop")
def agent_stop(user_id: int = Depends(get_current_user_id)):
    """Stop agent."""
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE agent_job SET is_running = 0 WHERE user_id = %s", (user_id,))
            conn.commit()
            cur.execute("INSERT INTO agent_log (user_id, message, log_type) VALUES (%s, %s, %s)", (user_id, "Agent stopped.", "log"))
            conn.commit()
    return {"ok": True, "message": "Agent stopped."}


@router.get("/agent/status")
def agent_status(user_id: int = Depends(get_current_user_id)):
    """Agent running status + settings + latest logs."""
    with get_db() as conn:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute(
                "SELECT is_running, symbol, `interval`, strategy, custom_prompt, market_type, trade_enabled, order_amount, order_amount_mode, max_open_positions, single_trade_if_max, max_mode_used, min_trade_interval_sec, leverage, interval_sec, model, started_at, last_run_at FROM agent_job WHERE user_id = %s",
                (user_id,),
            )
            job = cur.fetchone()
            cur.execute(
                "SELECT id, created_at, message, analysis_id, log_type FROM agent_log WHERE user_id = %s ORDER BY created_at DESC LIMIT 100",
                (user_id,),
            )
            logs = cur.fetchall()
    if not job:
        return {"is_running": False, "job": None, "logs": []}
    job_out = {k: v for k, v in job.items()}
    if job_out.get("started_at") and hasattr(job_out["started_at"], "isoformat"):
        job_out["started_at"] = job_out["started_at"].isoformat()
    if job_out.get("last_run_at") and hasattr(job_out["last_run_at"], "isoformat"):
        job_out["last_run_at"] = job_out["last_run_at"].isoformat()
    logs_out = [
        {"id": r["id"], "time": r["created_at"].strftime("%H:%M:%S") if hasattr(r["created_at"], "strftime") else str(r["created_at"]), "message": r["message"], "analysis_id": r["analysis_id"], "log_type": r["log_type"]}
        for r in logs
    ]
    last_analysis = None
    for r in logs:
        if r.get("analysis_id"):
            with get_db() as conn2:
                with conn2.cursor(pymysql.cursors.DictCursor) as cur2:
                    cur2.execute(
                        "SELECT id, action, analysis_text, message_short, buy_at, sell_at FROM agent_analyses WHERE id = %s AND user_id = %s",
                        (r["analysis_id"], user_id),
                    )
                    row = cur2.fetchone()
            if row:
                created_at = r.get("created_at")
                last_analysis = {
                    "action": row["action"],
                    "analysis": row["analysis_text"] or "",
                    "message": row["message_short"] or row["analysis_text"] or "",
                    "buy_at": float(row["buy_at"]) if row["buy_at"] is not None else None,
                    "sell_at": float(row["sell_at"]) if row["sell_at"] is not None else None,
                    "time": created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at),
                }
            break
    return {"is_running": bool(job["is_running"]), "job": job_out, "logs": logs_out, "last_analysis": last_analysis}


@router.post("/chat", response_model=ChatResponse)
async def chat(
    body: ChatRequest,
    user_id: int = Depends(get_current_user_id),
):
    s = get_settings()
    model_id = (body.model or DEFAULT_CHAT_MODEL).strip() or DEFAULT_CHAT_MODEL
    if model_id not in MODEL_REGISTRY:
        model_id = DEFAULT_CHAT_MODEL
    info = MODEL_REGISTRY.get(model_id, {})
    provider = info.get("provider", "glm")
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for m in body.messages:
        if m.role in ("user", "assistant", "system"):
            messages.append({"role": m.role, "content": m.content})
    payload = {"model": model_id, "messages": messages}
    if provider == "glm" and getattr(s, "GLM5_THINKING", True):
        payload["thinking"] = {"type": "enabled"}
    if provider == "openai":
        if not getattr(s, "OPENAI_API_KEY", None) or not s.OPENAI_API_KEY:
            raise HTTPException(status_code=503, detail="OpenAI API key is not configured.")
        base = (getattr(s, "OPENAI_BASE_URL", None) or "https://api.openai.com/v1").strip().rstrip("/")
        url = f"{base}/chat/completions"
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.post(url, headers={"Content-Type": "application/json", "Authorization": f"Bearer {s.OPENAI_API_KEY}"}, json=payload)
    else:
        if not s.GLM5_API_KEY:
            raise HTTPException(status_code=503, detail="GLM API key is not configured.")
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.post(
                f"{s.GLM5_BASE_URL.rstrip('/')}/chat/completions",
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {s.GLM5_API_KEY}"},
                json=payload,
            )
    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail=r.text or "API error")
    data = r.json()
    try:
        content = (data.get("choices") or [{}])[0].get("message", {}).get("content") or ""
    except (KeyError, IndexError):
        raise HTTPException(status_code=502, detail="Unexpected response format")
    u = data.get("usage") or {}
    input_tok = u.get("prompt_tokens") or 0
    output_tok = u.get("completion_tokens") or 0
    cached_tok = u.get("prompt_tokens_details", {}).get("cached_tokens") or u.get("input_tokens_details", {}).get("cached_tokens") or 0
    cost = _compute_cost(model_id, input_tok, output_tok, cached_tok)
    if cost > 0:
        if _get_balance(user_id) < cost:
            raise HTTPException(status_code=402, detail="Insufficient balance. Please top up your balance.")
        if not _deduct_balance(user_id, cost, None):
            raise HTTPException(status_code=402, detail="Insufficient balance.")
        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO chat_usage (user_id, model, input_tokens, output_tokens, cached_input_tokens, cost_usd) VALUES (%s, %s, %s, %s, %s, %s)",
                    (user_id, model_id, input_tok, output_tok, cached_tok, cost),
                )
                conn.commit()
    return ChatResponse(content=content)
