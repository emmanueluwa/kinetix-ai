from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import UUID, uuid4

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db  # adjust to your deps
from app.models.photo_checkin import PhotoCheckIn
from app.models.user import User  # adjust to your User model path
from app.models.workout import DailyWorkout  # adjust to your DailyWorkout model path
from app.schemas.photo_checkin import PhotoCheckInResponse, PhotoHistoryResponse
from app.services.ai_coach import AICoachService, PhysiqueAssessment
from app.services.storage import (
    get_object_bytes,
    get_presigned_url,
    put_object_bytes,
    strip_exif_and_encode_webp,
)

router = APIRouter(prefix="/photos", tags=["photos"])

MAX_UPLOAD_BYTES = 12 * 1024 * 1024  # 12 MiB raw upload cap


async def _compute_adherence_summary(db: AsyncSession, user_id: UUID) -> str:
    cutoff = datetime.now(timezone.utc) - timedelta(days=14)
    stmt = (
        select(DailyWorkout)
        .where(DailyWorkout.user_id == user_id)
        .order_by(DailyWorkout.created_at.desc())
        .limit(14)
    )
    rows = (await db.execute(stmt)).scalars().all()
    recent_rows = [
        r
        for r in rows
        if getattr(r, "created_at", None) is None or r.created_at >= cutoff
    ] or rows

    if not recent_rows:
        return "No recent workout plans logged in the last 14 days."

    total_tasks = 0
    completed_tasks = 0
    sessions_with_work = 0
    for plan in recent_rows:
        tasks = getattr(plan, "tasks", None) or []
        if not isinstance(tasks, list):
            continue
        plan_completed = sum(
            1 for t in tasks if isinstance(t, dict) and t.get("completed")
        )
        total_tasks += len(tasks)
        completed_tasks += plan_completed
        if plan_completed > 0:
            sessions_with_work += 1

    pct = round((completed_tasks / total_tasks) * 100) if total_tasks else 0
    return (
        f"{len(recent_rows)} plans in lookback window, {sessions_with_work} with completed tasks; "
        f"{completed_tasks}/{total_tasks} tasks completed ({pct}% adherence)."
    )


def _to_response(
    checkin: PhotoCheckIn,
    *,
    days_since_previous: int | None = None,
) -> PhotoCheckInResponse:
    assessment = PhysiqueAssessment.model_validate(checkin.assessment_payload)
    return PhotoCheckInResponse(
        id=checkin.id,
        user_id=checkin.user_id,
        pose_label=checkin.pose_label,
        notes=checkin.notes,
        preview_url=get_presigned_url(checkin.storage_key),
        days_since_previous=days_since_previous,
        created_at=checkin.created_at,
        assessment=assessment,
    )


@router.post(
    "/checkin",
    response_model=PhotoCheckInResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_photo_checkin(
    file: UploadFile = File(...),
    pose_label: str = Form(default="checkin"),
    notes: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PhotoCheckInResponse:
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Uploaded file must be an image.",
        )

    raw_bytes = await file.read(MAX_UPLOAD_BYTES + 1)
    if not raw_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Empty image upload.",
        )
    if len(raw_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Image exceeds maximum allowed size of 12 MiB.",
        )

    try:
        current_webp = await asyncio.to_thread(strip_exif_and_encode_webp, raw_bytes)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to decode or process image.",
        ) from exc

    now = datetime.now(timezone.utc)
    checkin_id = uuid4()
    storage_key = (
        f"checkins/{current_user.id}/{now.strftime('%Y/%m/%d')}/{checkin_id}.webp"
    )

    await asyncio.to_thread(put_object_bytes, storage_key, current_webp, "image/webp")

    # Fetch baseline (oldest) and previous (most recent) check-ins for delta comparison
    oldest_stmt = (
        select(PhotoCheckIn)
        .where(PhotoCheckIn.user_id == current_user.id)
        .order_by(PhotoCheckIn.created_at.asc())
        .limit(1)
    )
    latest_stmt = (
        select(PhotoCheckIn)
        .where(PhotoCheckIn.user_id == current_user.id)
        .order_by(PhotoCheckIn.created_at.desc())
        .limit(1)
    )
    baseline_row = (await db.execute(oldest_stmt)).scalar_one_or_none()
    previous_row = (await db.execute(latest_stmt)).scalar_one_or_none()

    previous_webp: bytes | None = None
    baseline_webp: bytes | None = None
    days_since_previous: int | None = None

    if previous_row is not None:
        days_since_previous = max(0, (now - previous_row.created_at).days)
        previous_webp = await asyncio.to_thread(
            get_object_bytes, previous_row.storage_key
        )

    if baseline_row is not None and (
        previous_row is None or baseline_row.id != previous_row.id
    ):
        baseline_webp = await asyncio.to_thread(
            get_object_bytes, baseline_row.storage_key
        )

    adherence_summary = await _compute_adherence_summary(db, current_user.id)
    goal_summary = (
        getattr(current_user, "goal_summary", None)
        or "Build lean strength and conditioning"
    )
    preferred_style = (
        getattr(current_user, "preferred_style", None) or "calisthenics_prison"
    )

    coach = AICoachService()
    assessment = await coach.evaluate_checkin(
        current_webp=current_webp,
        previous_webp=previous_webp,
        baseline_webp=baseline_webp,
        goal_summary=goal_summary,
        preferred_style=preferred_style,
        adherence_summary=adherence_summary,
        days_since_previous=days_since_previous,
    )

    record = PhotoCheckIn(
        id=checkin_id,
        user_id=current_user.id,
        storage_key=storage_key,
        pose_label=pose_label,
        notes=notes,
        assessment_payload=assessment.model_dump(mode="json"),
        created_at=now,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)

    return _to_response(record, days_since_previous=days_since_previous)


@router.get("", response_model=PhotoHistoryResponse)
async def list_photo_history(
    order: Literal["asc", "desc"] = Query(default="asc"),
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PhotoHistoryResponse:
    # Always fetch ascending first so days_since_previous is exact across the series
    stmt = (
        select(PhotoCheckIn)
        .where(PhotoCheckIn.user_id == current_user.id)
        .order_by(PhotoCheckIn.created_at.asc())
    )
    rows = (await db.execute(stmt)).scalars().all()

    enriched: list[PhotoCheckInResponse] = []
    prev_dt: datetime | None = None
    for row in rows:
        delta_days = (
            max(0, (row.created_at - prev_dt).days) if prev_dt is not None else None
        )
        enriched.append(_to_response(row, days_since_previous=delta_days))
        prev_dt = row.created_at

    if order == "desc":
        enriched.reverse()

    sliced = enriched[:limit]
    return PhotoHistoryResponse(total=len(enriched), checkins=sliced)
