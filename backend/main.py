# Vox Trader Backend - FastAPI
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import auth_router, settings_router, binance_router, ai_router, demo_router, billing_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    ai_router.start_agent_runner()
    yield


app = FastAPI(title="Vox Trader API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(settings_router.router)
app.include_router(binance_router.router)
app.include_router(ai_router.router)
app.include_router(demo_router.router)
app.include_router(billing_router.router)


@app.get("/health")
def health():
    return {"status": "ok"}
