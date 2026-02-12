# Vox Trader - Agent background chart (Binance klines -> PNG base64)
import base64
import io
import httpx

BINANCE_BASE = "https://api.binance.com"


def fetch_klines(symbol: str, interval: str, limit: int = 100) -> list[list[float]]:
    """Fetch OHLC klines from Binance. Each item is [open, high, low, close] (float)."""
    with httpx.Client(timeout=10.0) as client:
        r = client.get(
            f"{BINANCE_BASE}/api/v3/klines",
            params={"symbol": symbol.upper(), "interval": interval, "limit": limit},
        )
    if r.status_code != 200:
        raise ValueError(f"Failed to fetch klines: {r.status_code}")
    data = r.json()
    return [
        [float(c[1]), float(c[2]), float(c[3]), float(c[4])]
        for c in data
    ]


def render_candlestick_base64(klines: list[list[float]], title: str = "BTCUSDT") -> str:
    """Render candlestick chart from OHLC list and return PNG base64. Dark theme matches frontend."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import matplotlib.dates as mdates
    from matplotlib.patches import Rectangle
    from matplotlib.collections import LineCollection
    import numpy as np

    if not klines:
        raise ValueError("Klines are empty")

    n = len(klines)
    opens = np.array([k[0] for k in klines])
    highs = np.array([k[1] for k in klines])
    lows = np.array([k[2] for k in klines])
    closes = np.array([k[3] for k in klines])

    fig, ax = plt.subplots(figsize=(8, 4), facecolor="#18181b")
    ax.set_facecolor("#18181b")
    ax.tick_params(colors="#a1a1aa", labelsize=8)
    ax.spines["bottom"].set_color("#3f3f46")
    ax.spines["top"].set_color("#3f3f46")
    ax.spines["left"].set_color("#3f3f46")
    ax.spines["right"].set_color("#3f3f46")
    ax.set_title(title, color="#e4e4e7", fontsize=10)

    x = np.arange(n)
    width = 0.6
    for i in range(n):
        o, h, l, c = opens[i], highs[i], lows[i], closes[i]
        color = "#22c55e" if c >= o else "#ef4444"
        # Wick
        ax.plot([i, i], [l, h], color=color, linewidth=0.8, solid_capstyle="round")
        # Body
        body_bottom = min(o, c)
        body_height = abs(c - o)
        if body_height < 1e-12:
            body_height = (h - l) * 0.01 if h != l else 1e-12
        ax.add_patch(
            Rectangle((i - width / 2, body_bottom), width, body_height, facecolor=color, edgecolor=color)
        )

    ax.set_xlim(-0.5, n - 0.5)
    ax.set_ylim(lows.min() * 0.998, highs.max() * 1.002)
    ax.xaxis.set_major_locator(plt.MaxNLocator(8))
    fig.tight_layout(pad=0.5)

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=100, bbox_inches="tight", facecolor="#18181b", edgecolor="none")
    plt.close(fig)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode("ascii")
