from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import logfire
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncEngine

from app.core.config import Settings


def configure_telemetry(
    app: FastAPI, settings: Settings, db_engine: AsyncEngine | None = None
) -> None:
    """Initialize OpenTelemetry / Pydantic Logfire observability across the stack."""
    token = (
        settings.logfire_token.get_secret_value() if settings.logfire_token else None
    )

    logfire.configure(
        token=token,
        service_name="kinetix-backend",
        environment=settings.app_env,
        send_to_logfire="if-token-present",
    )

    # Instrument inbound FastAPI requests and outbound HTTPX calls
    logfire.instrument_fastapi(app, capture_headers=False)
    logfire.instrument_httpx(capture_headers=False)

    # Instrument PydanticAI agents (token usage, retries, structured validation spans)
    logfire.instrument_pydantic_ai()

    # Instrument async SQLAlchemy queries if engine is provided
    if db_engine is not None:
        logfire.instrument_sqlalchemy(engine=db_engine.sync_engine)


@contextmanager
def trace_cv_step(step_name: str, **attributes: Any) -> Iterator[None]:
    """Measure deterministic computer-vision preprocessing latency in traces."""
    with logfire.span(f"cv.{step_name}", **attributes):
        yield
