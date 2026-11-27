import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import jwt
import redis.asyncio as redis
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.api.v1.endpoints import router as v1_router
from app.core.config import get_settings
from app.core.telemetry import configure_telemetry
from app.db.models import Base, create_engine_and_sessionmaker


class DevTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: uuid.UUID


def create_app() -> FastAPI:
    settings = get_settings()
    engine, session_factory = create_engine_and_sessionmaker()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.db_engine = engine
        app.state.session_factory = session_factory

        # Initialize Redis rate-limiter client if reachable
        redis_client: redis.Redis | None = None
        try:
            redis_client = redis.from_url(
                settings.redis_url.get_secret_value(),
                encoding="utf-8",
                decode_responses=True,
            )
            await redis_client.ping()
            app.state.redis = redis_client
        except Exception:
            app.state.redis = None

        # Auto-create tables in development/staging for fast local testing
        if settings.app_env in ("development", "staging"):
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)

        yield

        if redis_client is not None:
            await redis_client.aclose()
        await engine.dispose()

    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        debug=settings.debug,
        lifespan=lifespan,
    )

    configure_telemetry(app, settings, db_engine=engine)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(v1_router)

    @app.get("/health", tags=["system"])
    async def healthcheck() -> dict[str, str]:
        return {"status": "ok", "service": settings.app_name}

    if settings.app_env == "development":

        @app.post("/dev/token", response_model=DevTokenResponse, tags=["dev"])
        async def issue_dev_token(user_id: uuid.UUID | None = None) -> DevTokenResponse:
            resolved_user_id = user_id or uuid.UUID(
                "11111111-1111-1111-1111-111111111111"
            )
            now = int(time.time())
            payload = {
                "sub": str(resolved_user_id),
                "email": "builder@kinetix.local",
                "iat": now,
                "exp": now + 86_400,
            }
            token = jwt.encode(
                payload,
                settings.secret_key.get_secret_value(),
                algorithm="HS256",
            )
            return DevTokenResponse(
                access_token=token,
                user_id=resolved_user_id,
            )

    return app


app = create_app()
