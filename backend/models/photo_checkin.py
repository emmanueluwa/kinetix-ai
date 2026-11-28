from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base  # adjust to your DeclarativeBase import path


class PhotoCheckIn(Base):
    __tablename__ = "photo_checkins"
    __table_args__ = (Index("ix_photo_checkins_user_created", "user_id", "created_at"),)

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid4
    )
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    storage_key: Mapped[str] = mapped_column(String(512), nullable=False)
    pose_label: Mapped[str] = mapped_column(
        String(64), nullable=False, default="checkin"
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Serialized PhysiqueAssessment dict stored as PostgreSQL JSONB
    assessment_payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
