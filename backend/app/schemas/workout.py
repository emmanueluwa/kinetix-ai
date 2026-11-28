from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, Field


class GeneratedWorkoutTask(BaseModel):
    exercise_name: str = Field(
        description="Specific compound or calisthenics exercise name"
    )
    target_muscle: str = Field(description="Primary muscle groups worked")
    equipment_used: str = Field(
        description="Bodyweight or specific equipment from user's list"
    )
    sets: int = Field(ge=1, le=10)
    rep_range: str = Field(
        description="Target reps, ladder, or timed interval (e.g., '15-20' or '45s work')"
    )
    rest_seconds: int = Field(ge=15, le=240)
    execution_cue: str = Field(description="Concise, actionable form or pacing cue")
    completed: bool = Field(default=False)


class GeneratedDailyWorkout(BaseModel):
    focus_area: str = Field(
        description="Session theme aligned with user style and goals"
    )
    rationale: str = Field(
        description="Why these compound movements fit the user's style, goals, and check-in data"
    )
    tasks: list[GeneratedWorkoutTask] = Field(min_length=3, max_length=7)


class GenerateWorkoutRequest(BaseModel):
    regenerate: bool = Field(default=False)
    session_request: Optional[str] = Field(default=None, max_length=500)


class TaskCompletionPatch(BaseModel):
    completed: bool


class DailyWorkoutResponse(BaseModel):
    id: str
    plan_date: str
    focus_area: str
    rationale: str
    tasks: list[GeneratedWorkoutTask]

    model_config = {"from_attributes": True}
