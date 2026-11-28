import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.core.config import Settings, get_settings
from app.core.security import AuthenticatedUser, RateLimiter, get_current_user
from app.db.models import DailyWorkoutPlan, PhotoRole, PhysiquePhoto, UserProfile
from app.services.ai_coach import (
    AICoachService,
    PhysiqueAssessment,
    WorkoutPlanOutput,
)
from app.services.storage import ObjectStorageService
from app.services.vision_align import PhysiqueVisionNormalizer

router = APIRouter(prefix="/api/v1", tags=["kinetix-v1"])


async def get_db_session(request: Request) -> Any:
    async with request.app.state.session_factory() as session:
        yield session


def get_storage(
    settings: Annotated[Settings, Depends(get_settings)],
) -> ObjectStorageService:
    return ObjectStorageService(settings)


def get_normalizer() -> PhysiqueVisionNormalizer:
    return PhysiqueVisionNormalizer()


def get_ai_coach(
    settings: Annotated[Settings, Depends(get_settings)],
) -> AICoachService:
    return AICoachService(settings)


async def enforce_ai_rate_limit(
    request: Request,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> None:
    redis_client = getattr(request.app.state, "redis", None)
    if redis_client is None:
        return
    limiter = RateLimiter(redis_client)
    await limiter.check_ai_quota(user.user_id, settings.ai_rate_limit_per_minute)


class ProfileUpsertRequest(BaseModel):
    goal_summary: str = Field(
        default="Build lean muscle and reduce body fat", max_length=500
    )
    preferred_style: str = Field(default="hypertrophy", max_length=100)
    available_equipment: list[str] = Field(
        default_factory=lambda: ["dumbbells", "pull-up bar", "bench"]
    )
    injuries_or_constraints: str | None = Field(default=None, max_length=500)
    days_per_week: int = Field(default=4, ge=1, le=7)


class ProfileResponse(BaseModel):
    user_id: uuid.UUID
    goal_summary: str
    preferred_style: str
    available_equipment: list[str]
    injuries_or_constraints: str | None
    days_per_week: int
    baseline_photo_id: uuid.UUID | None
    goal_photo_id: uuid.UUID | None


class PresignUploadRequest(BaseModel):
    content_type: str = Field(default="image/jpeg", pattern="^image/(jpeg|png|webp)$")


class PresignUploadResponse(BaseModel):
    object_key: str
    upload_url: str
    expires_in: int


class ProcessPhotoRequest(BaseModel):
    object_key: str
    role: PhotoRole
    weight_kg: float | None = Field(default=None, gt=20, lt=350)
    user_notes: str | None = Field(default=None, max_length=500)


class PhotoAnalysisResponse(BaseModel):
    photo_id: uuid.UUID
    role: PhotoRole
    aligned_preview_url: str
    pose_detected: bool
    shoulder_to_waist_ratio: float | None
    waist_to_hip_ratio: float | None
    ai_analysis: dict[str, Any] | None


class PhotoHistoryEntryResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    pose_label: str
    notes: str | None = None
    preview_url: str
    days_since_previous: int | None = None
    created_at: datetime
    assessment: dict[str, Any]


class PhotoHistoryResponse(BaseModel):
    total: int
    checkins: list[PhotoHistoryEntryResponse]


class DailyWorkoutResponse(BaseModel):
    plan_id: uuid.UUID
    plan_date: date
    focus_area: str
    rationale: str
    tasks: list[dict[str, Any]]
    completed: bool


class GenerateWorkoutRequest(BaseModel):
    regenerate: bool = False
    session_request: str | None = Field(default=None, max_length=500)


class TaskCompletionRequest(BaseModel):
    completed: bool


async def _compute_adherence_summary(db: AsyncSession, user_id: uuid.UUID) -> str:
    cutoff = date.today() - timedelta(days=14)
    stmt = (
        select(DailyWorkoutPlan)
        .where(
            DailyWorkoutPlan.user_id == user_id,
            DailyWorkoutPlan.plan_date >= cutoff,
        )
        .order_by(DailyWorkoutPlan.plan_date.desc())
        .limit(14)
    )
    rows = (await db.execute(stmt)).scalars().all()
    if not rows:
        return "No workout plans recorded in the last 14 days."

    total_tasks = 0
    completed_tasks = 0
    active_sessions = 0
    for plan in rows:
        tasks = plan.tasks if isinstance(plan.tasks, list) else []
        done_in_plan = sum(
            1 for t in tasks if isinstance(t, dict) and bool(t.get("completed"))
        )
        total_tasks += len(tasks)
        completed_tasks += done_in_plan
        if done_in_plan > 0 or plan.completed:
            active_sessions += 1

    pct = round((completed_tasks / total_tasks) * 100) if total_tasks else 0
    return (
        f"{len(rows)} plans over last 14 days, {active_sessions} with completed work; "
        f"{completed_tasks}/{total_tasks} tasks completed ({pct}% adherence)."
    )


async def _get_or_create_profile(
    db: AsyncSession, user_id: uuid.UUID, *, flush_only: bool = False
) -> UserProfile:
    profile = await db.get(UserProfile, user_id)
    if profile is None:
        profile = UserProfile(user_id=user_id)
        db.add(profile)
        if flush_only:
            await db.flush()
        else:
            await db.commit()
            await db.refresh(profile)
    return profile


@router.get("/profile", response_model=ProfileResponse)
async def get_profile(
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> ProfileResponse:
    profile = await _get_or_create_profile(db, user.user_id)
    return ProfileResponse(
        user_id=profile.user_id,
        goal_summary=profile.goal_summary,
        preferred_style=profile.preferred_style,
        available_equipment=profile.available_equipment,
        injuries_or_constraints=profile.injuries_or_constraints,
        days_per_week=profile.days_per_week,
        baseline_photo_id=profile.baseline_photo_id,
        goal_photo_id=profile.goal_photo_id,
    )


@router.put("/profile", response_model=ProfileResponse)
async def upsert_profile(
    body: ProfileUpsertRequest,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> ProfileResponse:
    profile = await _get_or_create_profile(db, user.user_id, flush_only=True)
    profile.goal_summary = body.goal_summary
    profile.preferred_style = body.preferred_style
    profile.available_equipment = body.available_equipment
    profile.injuries_or_constraints = body.injuries_or_constraints
    profile.days_per_week = body.days_per_week

    await db.commit()
    await db.refresh(profile)

    return ProfileResponse(
        user_id=profile.user_id,
        goal_summary=profile.goal_summary,
        preferred_style=profile.preferred_style,
        available_equipment=profile.available_equipment,
        injuries_or_constraints=profile.injuries_or_constraints,
        days_per_week=profile.days_per_week,
        baseline_photo_id=profile.baseline_photo_id,
        goal_photo_id=profile.goal_photo_id,
    )


@router.post("/photos/presign", response_model=PresignUploadResponse)
async def create_photo_upload_url(
    body: PresignUploadRequest,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    storage: Annotated[ObjectStorageService, Depends(get_storage)],
) -> PresignUploadResponse:
    result = storage.create_presigned_upload(
        user_id=user.user_id,
        category="raw",
        content_type=body.content_type,
    )
    return PresignUploadResponse(
        object_key=result.object_key,
        upload_url=result.upload_url,
        expires_in=result.expires_in,
    )


@router.post(
    "/photos/process",
    response_model=PhotoAnalysisResponse,
    dependencies=[Depends(enforce_ai_rate_limit)],
)
async def process_and_analyze_photo(
    body: ProcessPhotoRequest,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
    storage: Annotated[ObjectStorageService, Depends(get_storage)],
    normalizer: Annotated[PhysiqueVisionNormalizer, Depends(get_normalizer)],
    coach: Annotated[AICoachService, Depends(get_ai_coach)],
) -> PhotoAnalysisResponse:
    expected_prefix = f"users/{user.user_id}/"
    if not body.object_key.startswith(expected_prefix):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to storage key outside tenant boundary.",
        )

    profile = await _get_or_create_profile(db, user.user_id, flush_only=True)

    raw_bytes = storage.download_bytes(body.object_key)
    sanitized_bytes = storage.strip_exif_and_encode_webp(raw_bytes)
    norm_result = normalizer.normalize_and_measure(sanitized_bytes)

    aligned_key = f"users/{user.user_id}/aligned/{uuid.uuid4()}.webp"
    storage.upload_bytes(
        aligned_key, norm_result.aligned_image_bytes, content_type="image/webp"
    )

    latest_stmt = (
        select(PhysiquePhoto)
        .where(PhysiquePhoto.user_id == user.user_id)
        .order_by(PhysiquePhoto.created_at.desc())
        .limit(1)
    )
    previous_photo = (await db.execute(latest_stmt)).scalar_one_or_none()

    previous_webp: bytes | None = None
    baseline_webp: bytes | None = None
    days_since_previous: int | None = None

    if previous_photo is not None:
        now_utc = datetime.now(timezone.utc)
        prev_created = previous_photo.created_at
        if prev_created.tzinfo is None:
            prev_created = prev_created.replace(tzinfo=timezone.utc)
        days_since_previous = max(0, (now_utc - prev_created).days)
        prev_key = previous_photo.aligned_storage_key or previous_photo.raw_storage_key
        if prev_key:
            previous_webp = storage.download_bytes(prev_key)

    if profile.baseline_photo_id:
        base_photo = await db.get(PhysiquePhoto, profile.baseline_photo_id)
        if (
            base_photo
            and (previous_photo is None or base_photo.id != previous_photo.id)
            and base_photo.aligned_storage_key
        ):
            baseline_webp = storage.download_bytes(base_photo.aligned_storage_key)

    adherence_summary = await _compute_adherence_summary(db, user.user_id)
    swr = (
        norm_result.shoulder_to_waist_ratio
        if norm_result.shoulder_to_waist_ratio is not None
        else "N/A"
    )
    whr = (
        norm_result.waist_to_hip_ratio
        if norm_result.waist_to_hip_ratio is not None
        else "N/A"
    )
    goal_with_metrics = (
        f"{profile.goal_summary} "
        f"(Role: {body.role.value}; "
        f"Weight: {f'{body.weight_kg} kg' if body.weight_kg is not None else 'unlogged'}; "
        f"Shoulder:Waist: {swr}; "
        f"Waist:Hip: {whr}; "
        f"Notes: {body.user_notes or 'None'})"
    )

    try:
        assessment: PhysiqueAssessment = await coach.evaluate_checkin(
            current_webp=norm_result.aligned_image_bytes,
            previous_webp=previous_webp,
            baseline_webp=baseline_webp,
            goal_summary=goal_with_metrics,
            preferred_style=profile.preferred_style,
            adherence_summary=adherence_summary,
            days_since_previous=days_since_previous,
        )
        assessment_dict = assessment.model_dump(mode="json")
        assessment_dict["body_composition_summary"] = assessment.current_shape_summary
        assessment_dict["recommended_training_focus"] = (
            assessment.workout_adjustment.priority_muscle_groups
        )
    except Exception:
        assessment_dict = coach.build_fallback_assessment(
            role_label=body.role.value,
            goal_summary=profile.goal_summary,
            preferred_style=profile.preferred_style,
            days_since_previous=days_since_previous,
        )

    photo = PhysiquePhoto(
        user_id=user.user_id,
        role=body.role,
        raw_storage_key=body.object_key,
        aligned_storage_key=aligned_key,
        weight_kg=body.weight_kg,
        user_notes=body.user_notes,
        shoulder_to_waist_ratio=norm_result.shoulder_to_waist_ratio,
        waist_to_hip_ratio=norm_result.waist_to_hip_ratio,
        pose_landmarks=norm_result.landmarks_summary,
        ai_analysis=assessment_dict,
    )
    db.add(photo)
    await db.flush()

    if body.role == PhotoRole.BASELINE:
        profile.baseline_photo_id = photo.id
    elif body.role == PhotoRole.GOAL:
        profile.goal_photo_id = photo.id

    await db.commit()
    await db.refresh(photo)

    return PhotoAnalysisResponse(
        photo_id=photo.id,
        role=photo.role,
        aligned_preview_url=storage.create_presigned_read_url(aligned_key),
        pose_detected=norm_result.pose_detected,
        shoulder_to_waist_ratio=photo.shoulder_to_waist_ratio,
        waist_to_hip_ratio=photo.waist_to_hip_ratio,
        ai_analysis=photo.ai_analysis,
    )


@router.get("/photos", response_model=PhotoHistoryResponse)
async def list_photo_history(
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
    storage: Annotated[ObjectStorageService, Depends(get_storage)],
    coach: Annotated[AICoachService, Depends(get_ai_coach)],
    order: Literal["asc", "desc"] = "asc",
    limit: int = 50,
) -> PhotoHistoryResponse:
    clamped_limit = max(1, min(limit, 200))
    stmt = (
        select(PhysiquePhoto)
        .where(PhysiquePhoto.user_id == user.user_id)
        .order_by(PhysiquePhoto.created_at.asc())
    )
    rows = (await db.execute(stmt)).scalars().all()

    entries: list[PhotoHistoryEntryResponse] = []
    prev_created_at: datetime | None = None

    for row in rows:
        days_delta = (
            max(0, (row.created_at - prev_created_at).days)
            if prev_created_at is not None
            else None
        )
        prev_created_at = row.created_at

        key_for_preview = row.aligned_storage_key or row.raw_storage_key
        preview_url = storage.create_presigned_read_url(key_for_preview)
        assessment_payload = coach.normalize_assessment_payload(
            row.ai_analysis,
            role_label=row.role.value,
            days_delta=days_delta,
        )

        entries.append(
            PhotoHistoryEntryResponse(
                id=row.id,
                user_id=row.user_id,
                pose_label=row.role.value,
                notes=row.user_notes,
                preview_url=preview_url,
                days_since_previous=days_delta,
                created_at=row.created_at,
                assessment=assessment_payload,
            )
        )

    if order == "desc":
        entries.reverse()

    sliced = entries[:clamped_limit]
    return PhotoHistoryResponse(total=len(entries), checkins=sliced)


@router.post(
    "/workouts/today",
    response_model=DailyWorkoutResponse,
    dependencies=[Depends(enforce_ai_rate_limit)],
)
async def generate_todays_workout(
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
    coach: Annotated[AICoachService, Depends(get_ai_coach)],
    regenerate: bool = False,
) -> DailyWorkoutResponse:
    return await generate_workout_plan(
        body=GenerateWorkoutRequest(regenerate=regenerate, session_request=None),
        user=user,
        db=db,
        coach=coach,
    )


@router.post(
    "/workouts/generate",
    response_model=DailyWorkoutResponse,
    dependencies=[Depends(enforce_ai_rate_limit)],
)
async def generate_workout_plan(
    body: GenerateWorkoutRequest,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
    coach: Annotated[AICoachService, Depends(get_ai_coach)],
) -> DailyWorkoutResponse:
    today = date.today()

    existing_stmt = select(DailyWorkoutPlan).where(
        DailyWorkoutPlan.user_id == user.user_id,
        DailyWorkoutPlan.plan_date == today,
    )
    existing_plan = (await db.execute(existing_stmt)).scalar_one_or_none()

    if existing_plan is not None and not body.regenerate and not body.session_request:
        return DailyWorkoutResponse(
            plan_id=existing_plan.id,
            plan_date=existing_plan.plan_date,
            focus_area=existing_plan.focus_area,
            rationale=existing_plan.rationale,
            tasks=existing_plan.tasks,
            completed=existing_plan.completed,
        )

    profile = await _get_or_create_profile(db, user.user_id, flush_only=True)

    latest_photo_stmt = (
        select(PhysiquePhoto)
        .where(
            PhysiquePhoto.user_id == user.user_id,
            PhysiquePhoto.ai_analysis.is_not(None),
        )
        .order_by(PhysiquePhoto.created_at.desc())
        .limit(1)
    )
    latest_photo = (await db.execute(latest_photo_stmt)).scalar_one_or_none()
    adherence_summary = await _compute_adherence_summary(db, user.user_id)

    latest_assessment = (
        coach.normalize_assessment_payload(
            latest_photo.ai_analysis,
            role_label=latest_photo.role.value,
            days_delta=None,
        )
        if latest_photo is not None
        else None
    )

    coaching_context = coach.build_workout_coaching_context(
        plan_date=today,
        goal_summary=profile.goal_summary,
        preferred_style=profile.preferred_style,
        days_per_week=profile.days_per_week,
        available_equipment=profile.available_equipment,
        injuries_or_constraints=profile.injuries_or_constraints,
        adherence_summary=adherence_summary,
        latest_assessment=latest_assessment,
        session_request=body.session_request,
        regenerate=body.regenerate,
    )

    plan_output: WorkoutPlanOutput = await coach.generate_daily_workout(
        coaching_context=coaching_context
    )
    serialized_tasks = [
        {**task.model_dump(), "completed": False} for task in plan_output.tasks
    ]

    if existing_plan is not None:
        existing_plan.focus_area = plan_output.focus_area
        existing_plan.rationale = plan_output.rationale
        existing_plan.tasks = serialized_tasks
        existing_plan.completed = False
        flag_modified(existing_plan, "tasks")
        await db.commit()
        await db.refresh(existing_plan)
        plan = existing_plan
    else:
        plan = DailyWorkoutPlan(
            user_id=user.user_id,
            plan_date=today,
            focus_area=plan_output.focus_area,
            rationale=plan_output.rationale,
            tasks=serialized_tasks,
            completed=False,
        )
        db.add(plan)
        await db.commit()
        await db.refresh(plan)

    return DailyWorkoutResponse(
        plan_id=plan.id,
        plan_date=plan.plan_date,
        focus_area=plan.focus_area,
        rationale=plan.rationale,
        tasks=plan.tasks,
        completed=plan.completed,
    )


@router.patch(
    "/workouts/{plan_id}/tasks/{task_index}",
    response_model=DailyWorkoutResponse,
)
async def toggle_workout_task(
    plan_id: uuid.UUID,
    task_index: int,
    body: TaskCompletionRequest,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> DailyWorkoutResponse:
    plan = await db.get(DailyWorkoutPlan, plan_id)
    if plan is None or plan.user_id != user.user_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workout plan not found.",
        )

    tasks = list(plan.tasks or [])
    if task_index < 0 or task_index >= len(tasks):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid task index.",
        )

    tasks[task_index] = {**tasks[task_index], "completed": body.completed}
    plan.tasks = tasks
    plan.completed = len(tasks) > 0 and all(bool(t.get("completed")) for t in tasks)
    flag_modified(plan, "tasks")

    await db.commit()
    await db.refresh(plan)

    return DailyWorkoutResponse(
        plan_id=plan.id,
        plan_date=plan.plan_date,
        focus_area=plan.focus_area,
        rationale=plan.rationale,
        tasks=plan.tasks,
        completed=plan.completed,
    )
