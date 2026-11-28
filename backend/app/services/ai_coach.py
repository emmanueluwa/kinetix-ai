from __future__ import annotations

import os
from pydantic import BaseModel, Field
from pydantic_ai import Agent, BinaryContent
from pydantic_ai.models.xai import XaiModel
from pydantic_ai.providers.xai import XaiProvider
from pydantic_ai.settings import ModelSettings

from app.core.config import Settings, get_settings


class PhysiqueCritique(BaseModel):
    summary: str = Field(
        description="Concise assessment of current physique and alignment"
    )
    proportion_observations: list[str] = Field(
        default_factory=list,
        description="Observations on proportions, symmetry, and posture",
    )
    recommended_training_focus: list[str] = Field(
        default_factory=list,
        description="Priority training areas for upcoming sessions",
    )


class WorkoutTaskOutput(BaseModel):
    exercise_name: str = Field(description="Compound or calisthenics movement name")
    target_muscle: str = Field(description="Primary target muscle group")
    equipment_used: str = Field(description="Bodyweight or specific equipment used")
    sets: int = Field(ge=1, le=10)
    rep_range: str = Field(description="Reps, ladder scheme, or timed work interval")
    rest_seconds: int = Field(ge=15, le=240)
    execution_cue: str = Field(description="Actionable form or pacing cue")
    completed: bool = Field(default=False)


class WorkoutPlanOutput(BaseModel):
    focus_area: str = Field(description="Primary focus of today's session")
    rationale: str = Field(
        description="Why this workout matches goals, style, and check-ins"
    )
    tasks: list[WorkoutTaskOutput] = Field(min_length=3, max_length=7)


def _resolve_xai_api_key(settings: Settings) -> str:
    if settings.xai_api_key is not None:
        secret = settings.xai_api_key.get_secret_value().strip()
        if secret:
            return secret
    env_key = (os.environ.get("XAI_API_KEY") or "").strip()
    if env_key:
        return env_key
    raise RuntimeError(
        "XAI_API_KEY is not configured. Set XAI_API_KEY in backend/.env or your environment."
    )


def _build_xai_model(settings: Settings) -> XaiModel:
    api_key = _resolve_xai_api_key(settings)
    provider = XaiProvider(
        api_key=api_key,
        timeout=settings.ai_timeout_seconds,
    )
    return XaiModel(settings.xai_model, provider=provider)


class AICoachService:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self._model = _build_xai_model(self.settings)
        self._model_settings = ModelSettings(timeout=self.settings.ai_timeout_seconds)

        self._physique_agent = Agent(
            self._model,
            output_type=PhysiqueCritique,
            model_settings=self._model_settings,
            system_prompt=(
                "You are an objective physique and biomechanics coach. "
                "Analyze the athlete's normalized check-in image alongside any baseline/goal "
                "images and ratio metrics. Give clear, practical observations and priority "
                "training areas without fluff."
            ),
        )

        self._workout_agent = Agent(
            self._model,
            output_type=WorkoutPlanOutput,
            model_settings=self._model_settings,
            system_prompt=(
                "You are an elite calisthenics, strength, and physique coach. "
                "Generate a bespoke, high-efficiency daily workout tailored strictly to the "
                "athlete's training style, favorite movements, goal summary, available equipment, "
                "injury constraints, physique priorities, and optional session focus request. "
                "Prioritize high-density compound movements (such as burpees, push-up variations, "
                "pull-ups, dips, squats, and core density blocks when prison-style calisthenics is "
                "requested). Respect all injury limits and always set completed=false on new tasks."
            ),
        )

    async def analyze_physique(
        self,
        *,
        current_webp: bytes,
        baseline_webp: bytes | None = None,
        goal_webp: bytes | None = None,
        metrics_context: str,
    ) -> PhysiqueCritique:
        content: list[str | BinaryContent] = [
            metrics_context,
            "Current check-in image (aligned WebP):",
            BinaryContent(data=current_webp, media_type="image/webp"),
        ]

        if baseline_webp:
            content.extend(
                [
                    "Baseline reference image (WebP):",
                    BinaryContent(data=baseline_webp, media_type="image/webp"),
                ]
            )

        if goal_webp:
            content.extend(
                [
                    "Goal reference image (WebP):",
                    BinaryContent(data=goal_webp, media_type="image/webp"),
                ]
            )

        result = await self._physique_agent.run(content)
        return result.output

    async def generate_daily_workout(
        self,
        *,
        coaching_context: str,
    ) -> WorkoutPlanOutput:
        result = await self._workout_agent.run(coaching_context)
        return result.output
