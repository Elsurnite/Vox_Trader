# Vox Trader Backend - Config
import os
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # MySQL
    MYSQL_HOST: str = "localhost"
    MYSQL_PORT: int = 3306
    MYSQL_USER: str = "root"
    MYSQL_PASSWORD: str = ""
    MYSQL_DATABASE: str = "vox_trader"

    # JWT
    JWT_SECRET: str = "change_me_in_production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60
    # API key şifreleme (32 byte base64url). Yoksa JWT_SECRET ile türetilir.
    ENCRYPTION_KEY: str = ""

    # Z.AI GLM-4.6V-Flash (https://docs.z.ai)
    GLM5_API_KEY: str = ""
    GLM5_BASE_URL: str = "https://api.z.ai/api/paas/v4"
    # Görsel analiz için vision model. Agent grafik analizinde görsel varsa bu model kullanılır (GLM-4.6V-Flash görsel destekler).
    GLM_VISION_MODEL: str = "GLM-4.6V-Flash"

    # OpenAI (chat/completions)
    OPENAI_API_KEY: str = ""
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"
    # Magazala ödeme
    MAGAZALA_API_KEY: str = ""
    MAGAZALA_BASE_URL: str = "https://magazala.com/api/v1"
    BACKEND_PUBLIC_URL: str = "http://localhost:8423"
    FRONTEND_BASE_URL: str = "http://localhost:3000"

    @property
    def mysql_url(self) -> str:
        return (
            f"mysql+pymysql://{self.MYSQL_USER}:{self.MYSQL_PASSWORD}"
            f"@{self.MYSQL_HOST}:{self.MYSQL_PORT}/{self.MYSQL_DATABASE}"
        )

    @property
    def mysql_connect_kwargs(self) -> dict:
        return {
            "host": self.MYSQL_HOST,
            "port": self.MYSQL_PORT,
            "user": self.MYSQL_USER,
            "password": self.MYSQL_PASSWORD,
            "database": self.MYSQL_DATABASE,
            "charset": "utf8mb4",
        }

    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache
def get_settings() -> Settings:
    return Settings()
