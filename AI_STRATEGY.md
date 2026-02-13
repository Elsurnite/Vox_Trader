# AI Strategy — Vox Trader

<p align="center">
  <strong>Hybrid AI architecture</strong><br/>
  <em>On-device/self-hosted model for trading + external API for NLP and reports</em>
</p>

---

## Approach: Hybrid System

| Component | Role | Use when |
|-----------|------|----------|
| **Own AI model** | Trading engine | Signals, technical analysis, risk, real-time predictions |
| **External AI API** | Support | News/sentiment, reports, user Q&A, code/strategy help |

---

## 1. Own AI Model (core engine)

**Responsibilities:**

- Trading signals (BUY/SELL/HOLD)
- Technical analysis and pattern recognition
- Position sizing / risk logic
- Real-time predictions (low latency)

**Options (for implementation):**

- LSTM/GRU — time series prediction
- Transformer (e.g. PatchTST) — sequence-to-sequence
- Reinforcement learning — strategy tuning
- Ensemble — combine multiple models

**Benefits:** Low latency (&lt; 100 ms), scalable cost, trading-specific, data stays on your side.

---

## 2. External AI API (support)

**Responsibilities:**

- News/sentiment analysis (crypto)
- Report generation (daily/weekly)
- User Q&A and explanations
- Strategy/code assistance

**Suggested providers:** OpenAI (GPT-4/5), Anthropic (Claude), Google (Gemini).

**Usage rule:** Call only when needed (news, reports, or user query). Do not use for real-time trading decisions.

```typescript
// Example: call only when needed
if (needsNewsAnalysis || needsReport || userQuery) {
  const result = await callExternalAI(prompt);
}
```

**Trade-offs:** Strong NLP, fast to integrate; higher latency and per-token cost. Keep API keys in `backend/.env` and never in frontend.

---

## Architecture (high level)

```text
Frontend (Next.js)
        │
Backend (FastAPI / Node if applicable)
        │
   ┌────┴────┐
   │         │
Own model   External API
(fast,      (NLP, reports,
 trading)    when needed)
```

Align with existing stack: frontend → backend → own model + optional external API.

---

## Usage by scenario

**Scenario 1 — Trading signal**

- Use **own model** only.
- Input: OHLCV + indicators; output: BUY/SELL/HOLD (see `MODEL_INFO.md`).

**Scenario 2 — News / sentiment**

- Use **external API** with a prompt that includes article text and asks for sentiment/summary.

**Scenario 3 — User question**

- Use **external API** with market context (e.g. current pair, recent moves) so answers are relevant.

---

## Cost (for planning)

| Component | Typical cost | Notes |
|-----------|--------------|--------|
| Own model | GPU server ~ $50–200/mo, scale as needed | Fixed, scalable |
| External API | ~ $0.03–0.06 per 1K tokens; 10K–100K tokens/day → order of $0.30–6/day | Usage-based |

**Recommendation:** Use own model for all trading signals; use external API only for NLP (news, reports, chat).

---

## Phased rollout

**Phase 1 — MVP**

- Simple technical indicators (RSI, MACD)
- External API for news/sentiment
- Basic trading signals (can be rule-based first)

**Phase 2 — Own model**

- Data pipeline and cleaning
- Train model (e.g. LSTM or PatchTST)
- Backtest and tune
- Deploy inference in backend

**Phase 3 — Optimization**

- Optional: RL, ensemble, or real-time learning
- Deeper integration of external AI for reports and UX

---

## Summary

- **Trading path:** Own model only — low latency, full control, no per-call API cost for signals.
- **NLP path:** External API — news, reports, user Q&A.
- **Security:** Keep API keys in backend env; do not send sensitive trading logic or keys to external APIs.

This keeps the app suitable for implementation: clear boundaries, concrete scenarios, and alignment with the existing README and `MODEL_INFO.md`.
