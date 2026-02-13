# PatchTST — Trading Model

<p align="center">
  <strong>Chosen forecasting model for Vox Trader</strong><br/>
  <em>Patch-based Time Series Transformer for price prediction and trading signals</em>
</p>

---

## Why PatchTST

- **State-of-the-art** for time series forecasting (2025)
- **Fast** training and inference
- **Multivariate** — handles OHLCV and technical indicators together
- **Long-range dependencies** — captures longer-term patterns
- **Crypto-oriented** — validated on financial-style data

---

## Model Spec

| Aspect | Detail |
|--------|--------|
| Architecture | Transformer (self-attention, patch-based) |
| Input | Historical OHLCV + technical indicators |
| Output | Future price prediction + BUY/SELL/HOLD signal |
| Training | Supervised on historical data |
| Inference | Real-time target: &lt; 100 ms |

### Technical Notes

- **Patch-based:** Time series is split into patches; each patch is one “word” for the transformer.
- **Self-attention:** Captures long-range dependencies.
- **Multi-head attention:** Learns different time scales.
- **Encoder / decoder:** Sequence-to-sequence style prediction.

---

## Input / Output Contract (for implementation)

**Input (per request):**

- Last N candles (e.g. 100) — OHLCV
- Technical indicators: RSI, MACD, Bollinger Bands
- Volume data

**Output:**

- Price forecast for next 1–24 hours (configurable horizon)
- Trading signal: `BUY` | `SELL` | `HOLD`
- Optional confidence score

Use this contract when wiring the model into the backend (e.g. FastAPI service or agent).

---

## Alternative Models (reference)

| Model   | Performance | Speed | Complexity | Use case |
|--------|-------------|-------|------------|----------|
| **PatchTST** | High | High | Medium | **Recommended** |
| TFT        | Good | Medium | High | Alternative |
| LSTM       | Medium | High | Low | Simple baseline |
| GRU        | Medium | High | Low | Simple baseline |

---

## Implementation Checklist

1. **Model choice** — PatchTST (done)
2. **Data** — Binance historical data pipeline
3. **Features** — OHLCV + technical indicators (RSI, MACD, etc.)
4. **Training** — Train on historical data; validate on holdout
5. **Backtesting** — Run strategy on historical data before live/demo
6. **Production** — Real-time inference endpoint (e.g. under `backend/`)

---

## References

- **Paper:** “A Time Series is Worth 64 Words: Long-term Forecasting with Transformers”
- **Code:** PatchTST repos; possible use of `patchtslib` or PyTorch implementation
