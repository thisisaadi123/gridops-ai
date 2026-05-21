"""Configuration settings for GridOps API."""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    """Application settings, loaded from environment variables or .env file."""
    # API Keys
    grok_api_key: str = ""
    huggingface_api_token: str = ""

    # Redis
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/0"
    celery_result_backend: str = "redis://localhost:6379/1"

    # App Config
    environment: str = "development"
    log_level: str = "INFO"

    # Chronos endpoint (public HF inference API — no cost for serverless)
    chronos_endpoint: str = (
        "https://api-inference.huggingface.co/models/amazon/chronos-bolt-base"
    )

    # Grok API base URL (OpenAI-compatible)
    groq_api_key: str
    groq_base_url: str = "https://api.groq.com/openai/v1"
    groq_model: str = "meta-llama/llama-4-maverick-17b-128e-instruct"

    # Task config
    task_result_expires: int = 3600  # 1 hour
    worker_concurrency: int = 2      # Safe for 8GB RAM

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache()
def get_settings() -> Settings:
    """Get cached application settings."""
    return Settings()
