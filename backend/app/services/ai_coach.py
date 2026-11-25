from typing import Any

from pydantic import BaseModel, Field
from pydantic_ai import Agent, BinaryContent
from pydantic_ai.models.fallback import FallbackModel
from pydantic_ai.models.google import GoogleModel
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.google import GoogleProvider
from pydantic_ai.providers.openai import OpenAIProvider

from app.core.config import Settings


class MuscleGroupAssessment(BaseModel):
    muscle_group: str = Field(
        ..., description="e.g., Deltoids, Upper Chest, Lats, Core, Quads"
    )
    visual_progress_notes: str = Field(
        ..., description="Objective comparison against baseline and goal reference"
    )
    priority_level: str = Field(..., pattern="^(high|moderate|maintain)$")


class PhysiqueCritique(BaseModel):
    overall_trajectory_score: int = Field(
        ..., ge=1, le=100, description="1-100 alignment score toward goal physique"
    )
    body_composition_summary: str = Field(
        ..., description="Honest, grounded summary of leanness and muscularity changes"
    )
    pose_and_lighting_caveats: str = Field(
        ..., description="Any remaining angle or lighting differences to keep in mind"
    )
    muscle_assessments: list[MuscleGroupAssessment] = Field(
        ..., min_length=2, max_length=6
    )
    recommended_training_focus: list[str] = Field(
        ...,
        min_length=2,
        max_length=4,
        description="Specific areas to prioritize next 2 weeks",
    )


class WorkoutTaskItem(BaseModel):
    exercise_name: str
    target_muscle: str
    sets: int = Field(..., ge=1, le=8)
    rep_range: str = Field(..., description="e.g., 8-12 or 12-15")
    rest_seconds: int = Field(..., ge=30, le=240)
    equipment_used: str
    execution_cue: str = Field(..., description="Concise biomechanical form cue")


class WorkoutPlanOutput(BaseModel):
    focus_area: str = Field(
        ..., description="e.g., Upper Body Hypertrophy & Lateral Delts"
    )
    rationale: str = Field(
        ...,
        description="Why this session matches current physique priorities and equipment",
    )
    tasks: list[WorkoutTaskItem] = Field(..., min_length=4, max_length=8)


def _build_resilient_model(settings: Settings) -> Any:
    """Create primary Gemini model with automatic OpenAI fallback if configured."""
    primary = GoogleModel(
        settings.primary_vision_model,
        provider=GoogleProvider(api_key=settings.gemini_api_key.get_secret_value()),
    )
    if settings.openai_api_key:
        fallback_name = settings.fallback_vision_model.removeprefix("openai:")
        fallback = OpenAIChatModel(
            fallback_name,
            provider=OpenAIProvider(api_key=settings.openai_api_key.get_secret_value()),
        )
        return FallbackModel(primary, fallback)
    return primary


class AICoachService:
    """Production PydanticAI agents for physique analysis and adaptive workout programming."""

    def __init__(self, settings: Settings) -> None:
        model = _build_resilient_model(settings)

        self.physique_agent: Agent[None, PhysiqueCritique] = Agent(
            model=model,
            output_type=PhysiqueCritique,
            retries=2,
            system_prompt=(
                "You are an elite physique and biomechanics coach. Compare the user's "
                "pose-normalized current physique image against their starting baseline and "
                "goal reference image. Ground your critique in the provided deterministic "
                "MediaPipe anthropometric ratios (shoulder-to-waist, waist-to-hip) and scale "
                "weight rather than guessing proportions. Be objective, encouraging, and direct."
            ),
        )

        self.workout_agent: Agent[None, WorkoutPlanOutput] = Agent(
            model=model,
            output_type=WorkoutPlanOutput,
            retries=2,
            system_prompt=(
                "You are an expert strength and hypertrophy programmer. Generate a practical, "
                "high-impact daily workout session strictly using ONLY the user's listed "
                "available equipment while respecting any injuries/constraints. Tailor exercise "
                "selection directly to their latest physique priority areas."
            ),
        )

    async def analyze_physique(
        self,
        *,
        current_webp: bytes,
        baseline_webp: bytes | None,
        goal_webp: bytes | None,
        metrics_context: str,
    ) -> PhysiqueCritique:
        prompt_parts: list[Any] = [
            f"Analyze the user's latest progress photo.\n\n{metrics_context}\n\n"
            "Image 1 is the CURRENT pose-normalized progress photo."
        ]
        prompt_parts.append(BinaryContent(data=current_webp, media_type="image/webp"))

        if baseline_webp is not None:
            prompt_parts.append("Next image is the STARTING BASELINE photo:")
            prompt_parts.append(
                BinaryContent(data=baseline_webp, media_type="image/webp")
            )

        if goal_webp is not None:
            prompt_parts.append("Next image is the TARGET GOAL physique reference:")
            prompt_parts.append(BinaryContent(data=goal_webp, media_type="image/webp"))

        result = await self.physique_agent.run(prompt_parts)
        return result.output

    async def generate_daily_workout(
        self, *, coaching_context: str
    ) -> WorkoutPlanOutput:
        result = await self.workout_agent.run(coaching_context)
        return result.output
