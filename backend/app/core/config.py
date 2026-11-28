from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # Application
    app_name: str = "Kinetix AI Coach"
    app_env: Literal["development", "staging", "production"] = "development"
    debug: bool = False
    secret_key: SecretStr = Field(..., min_length=16)

    # CORS Origins (comma-separated in env or list)
    allowed_origins: list[str] = ["http://localhost:3000"]

    # Database & Cache
    database_url: SecretStr
    redis_url: SecretStr

    # Object Storage (Cloudflare R2 / AWS S3)
    s3_endpoint_url: str
    s3_access_key_id: SecretStr
    s3_secret_access_key: SecretStr
    s3_bucket_name: str = "kinetix-private-uploads"
    s3_region: str = "auto"
    presigned_url_expiry_seconds: int = 300

    # AI Providers (Primary + Failover)
    gemini_api_key: SecretStr
    openai_api_key: SecretStr | None = None
    primary_vision_model: str = "gemini-3.8-flash"
    fallback_vision_model: str = "openai:gpt-4o"

    # Rate Limiting (Requests per minute per user)
    ai_rate_limit_per_minute: int = 10

    # Observability (Pydantic Logfire / OpenTelemetry)
    logfire_token: SecretStr | None = None

    # xAI Grok configuration
    xai_api_key: SecretStr | None = Field(default=None)
    xai_model: str = Field(default="grok-4.7")
    ai_timeout_seconds: float = Field(default=45.0, ge=5.0, le=180.0)


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
