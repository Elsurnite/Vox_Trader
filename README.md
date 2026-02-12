# Vox Trader

<p align="center">
  <strong>AI-assisted crypto analysis dashboard</strong><br/>
  <em>Prototype for research, testing, and demo trading workflows</em>
</p>

<p align="center">
  <img alt="status" src="https://img.shields.io/badge/status-prototype-orange" />
  <img alt="frontend" src="https://img.shields.io/badge/frontend-Next.js-111827" />
  <img alt="backend" src="https://img.shields.io/badge/backend-FastAPI-0ea5e9" />
  <img alt="database" src="https://img.shields.io/badge/database-MySQL-2563eb" />
</p>

---

## Current Trading Status

> **Important:** At this stage, order execution is **demo balance only**.
>
> - Real-money trading is **not enabled** in the current prototype.
> - Agent actions (BUY/SELL) are executed only through demo trading endpoints.

---

## Risk and Liability Disclaimer

This repository is an **early-stage prototype**.

- Not production-ready
- Not financial advice
- No profit guarantee
- No warranty ("as is")
- You are fully responsible for all usage decisions

---

## Highlights

- Authentication (register/login)
- Live chart display and market streaming
- AI chat assistant
- AI Agent mode with periodic BUY/SELL/HOLD suggestions
- Demo spot/futures trading and performance tracking
- Optional Binance account/trade history read integration

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14, React, TypeScript |
| Backend | FastAPI, Python |
| Database | MySQL |
| AI | Z.AI GLM (primary), optional OpenAI |
| Market Data | Binance APIs |

---

## Project Structure

```text
Vox_Trader/
├── frontend/                    # Next.js app
├── backend/                     # FastAPI app
│   ├── main.py
│   ├── requirements.txt
│   └── scripts/create_database.py
├── package.json                 # root helper scripts
└── README.md
```

---

## Prerequisites

- Node.js 18+ and npm
- Python 3.10+
- MySQL 8+ (or compatible)

---

## Quick Start

### 1) Backend Setup

```bash
cd backend
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Create `backend/.env`:

```env
# MySQL
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=your_mysql_user
MYSQL_PASSWORD=your_mysql_password
MYSQL_DATABASE=vox_trader

# JWT
JWT_SECRET=change_me_in_production
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=60

# AI
GLM5_API_KEY=your_zai_api_key
# GLM5_BASE_URL=https://api.z.ai/api/paas/v4
# GLM_VISION_MODEL=GLM-4.6V-Flash

# Optional
OPENAI_API_KEY=
MAGAZALA_API_KEY=
MAGAZALA_BASE_URL=https://magazala.com/api/v1
BACKEND_PUBLIC_URL=http://localhost:8423
FRONTEND_BASE_URL=http://localhost:3000
```

### 2) Create Database and Tables

Run once:

```bash
cd backend
source venv/bin/activate   # Windows: venv\Scripts\activate
python scripts/create_database.py
```

This initializes the `vox_trader` database and required tables.

### 3) Start Backend

```bash
cd backend
source venv/bin/activate   # Windows: venv\Scripts\activate
python3 -m uvicorn main:app --reload --host 0.0.0.0 --port 8423
```

Backend URLs:

- API: `http://localhost:8423`
- Docs: `http://localhost:8423/docs`
- Health: `http://localhost:8423/health`

### 4) Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Frontend URL:

- `http://localhost:3000`

### 5) Optional: Run Both from Root

```bash
npm install
npm run dev
```

If `python` is not mapped to Python 3 in your environment, run backend manually with `python3`.

---

## Usage Flow

1. Open `http://localhost:3000`
2. Register/sign in
3. Go to `Settings` and configure demo mode
4. Open `Dashboard` for chart, AI chat, and Agent mode
5. Review signals, logs, and demo performance

---

## Security Notes

- Never commit real secrets
- Keep `backend/.env` private
- Rotate leaked keys immediately
- Use demo mode while testing

---

## Known Limits

- Prototype-level validation and resilience
- Provider/API outages can impact behavior
- Strategy quality is not guaranteed
- Not intended for unattended real-money operation

---

## Final Note

Vox Trader is for experimentation and learning.
It does **not** provide guaranteed returns, and it should not be treated as an automated profit system.
