import time
import uuid
from typing import Annotated

import jwt
import redis.asyncio as redis
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.core.config import Settings, get_settings

bearer_scheme = HTTPBearer(auto_error=True)


class AuthenticatedUser(BaseModel):
    user_id: uuid.UUID
    email: str | None = None


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(bearer_scheme)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> AuthenticatedUser:
    """Verify JWT Bearer token and extract tenant user_id."""
    token = credentials.credentials
    try:
        payload = jwt.decode(
            token,
            settings.secret_key.get_secret_value(),
            algorithms=["HS256"],
            options={"require": ["sub", "exp"]},
        )
        user_id = uuid.UUID(str(payload["sub"]))
        return AuthenticatedUser(user_id=user_id, email=payload.get("email"))
    except (jwt.PyJWTError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


class RateLimiter:
    """Sliding-window per-user rate limiter backed by Redis."""

    def __init__(self, redis_client: redis.Redis) -> None:
        self.redis = redis_client

    async def check_ai_quota(self, user_id: uuid.UUID, limit_per_minute: int) -> None:
        key = f"ratelimit:ai:{user_id}"
        now_ms = int(time.time() * 1000)
        window_start_ms = now_ms - 60_000

        async with self.redis.pipeline(transaction=True) as pipe:
            pipe.zremrangebyscore(key, 0, window_start_ms)
            pipe.zadd(key, {f"{now_ms}:{uuid.uuid4().hex[:6]}": now_ms})
            pipe.zcard(key)
            pipe.expire(key, 65)
            results = await pipe.execute()

        request_count: int = results[2]
        if request_count > limit_per_minute:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"AI rate limit exceeded ({limit_per_minute} requests/minute). Try again shortly.",
                headers={"Retry-After": "60"},
            )
