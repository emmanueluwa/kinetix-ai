from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.services.ai_coach import PhysiqueAssessment


class PhotoCheckInResponse(BaseModel):
    id: UUID
    user_id: UUID
    pose_label: str
    notes: str | None = None
    preview_url: str = Field(description="Presigned or served URL for the WebP image")
    days_since_previous: int | None = None
    created_at: datetime
    assessment: PhysiqueAssessment


class PhotoHistoryResponse(BaseModel):
    total: int
    checkins: list[PhotoCheckInResponse]
