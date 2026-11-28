from __future__ import annotations

import os
from datetime import date
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field
from pydantic_ai import Agent, BinaryContent
from pydantic_ai.models.xai import XaiModel
from pydantic_ai.providers.xai import XaiProvider
from pydantic_ai.settings import ModelSettings

from app.core.config import Settings, get_settings


class CoachingVerdict(str, Enum):
    STAY_THE_COURSE = "stay_the_course"
    TIGHTEN_NUTRITION = "tighten_nutrition"
    INCREASE_FUEL = "increase_fuel"
    PIVOT_VOLUME = "pivot_volume"
    DELOAD_RECOVER = "deload_recover"


class WorkoutAdjustment(BaseModel):
    priority_muscle_groups: list[str] = Field(
        min_length=1,
        max_length=3,
        description="Top 1-3 visual lagging areas or movement patterns to prioritize next.",
    )
    volume_and_density_directive: str = Field(
        description="Concrete programming rule (e.g., 'Add 2 density sets of horizontal pulls; keep rest under 45s')."
    )
    next_session_focus_prompt: str = Field(
        description="Ready-to-use prompt string that can be injected directly into POST /workouts/generate."
    )


class DietAdjustment(BaseModel):
    caloric_stance: str = Field(
        description="Directional energy balance based on shape vs. goal (e.g., 'Moderate deficit (-300 to -400 kcal)', 'Maintenance / Recomp', 'Lean surplus (+250 kcal)')."
    )
    protein_and_macro_priority: str = Field(
        description="Specific macro/hydration focus tied to current physique and training load."
    )
    immediate_weekly_habit: str = Field(
        description="One single, high-compliance dietary action for the next 7 days (no vague advice)."
    )


class PhysiqueAssessment(BaseModel):
    current_shape_summary: str = Field(
        description="Objective assessment of current body composition, muscle distribution, and posture relative to the stated goal."
    )
    delta_since_last_checkin: str = Field(
        description="Specific visual changes since previous check-in and baseline (or 'Baseline check-in' if first photo)."
    )
    gap_to_goal: str = Field(
        description="What specifically separates current shape from the target goal (e.g., shoulder-to-waist taper, conditioning, midsection leanness)."
    )
    verdict: CoachingVerdict
    workout_adjustment: WorkoutAdjustment
    diet_adjustment: DietAdjustment


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

        self._assessment_agent = Agent(
            self._model,
            output_type=PhysiqueAssessment,
            model_settings=self._model_settings,
            system_prompt=(
                "You are an elite strength, calisthenics, and physique coach replacing a personal trainer. "
                "Evaluate the athlete's current physique shape against their stated goal, using previous and "
                "baseline photos plus recent workout adherence data to measure real progress.\n\n"
                "Rules:\n"
                "1. Be direct, objective, and practical—never generic.\n"
                "2. Ground every workout adjustment in visible proportions, posture, and stated goals.\n"
                "3. Ground every diet adjustment in current body composition vs. goal AND recent training adherence "
                "(do not prescribe aggressive deficits if training adherence is low).\n"
                "4. Write `next_session_focus_prompt` as a crisp, actionable instruction ready for a workout generator."
            ),
        )

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

    @staticmethod
    def build_fallback_assessment(
        *,
        role_label: str,
        goal_summary: str,
        preferred_style: str,
        days_since_previous: int | None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "current_shape_summary": (
                f"{role_label.capitalize()} physique check-in aligned and saved; "
                "AI coaching summary temporarily unavailable."
            ),
            "delta_since_last_checkin": (
                f"{days_since_previous} day(s) since prior check-in."
                if days_since_previous is not None
                else "Initial check-in in series."
            ),
            "gap_to_goal": f"Continue progressing toward: {goal_summary}",
            "verdict": CoachingVerdict.STAY_THE_COURSE.value,
            "workout_adjustment": {
                "priority_muscle_groups": ["Full Body"],
                "volume_and_density_directive": (
                    "Maintain planned sets, clean technique, and consistent rest periods."
                ),
                "next_session_focus_prompt": (
                    f"Generate a {preferred_style} session aligned with: {goal_summary}."
                ),
            },
            "diet_adjustment": {
                "caloric_stance": "Goal-aligned energy balance",
                "protein_and_macro_priority": (
                    "Prioritize daily protein target and steady hydration."
                ),
                "immediate_weekly_habit": (
                    "Stay consistent with meals and sleep over the next 7 days."
                ),
            },
        }
        payload["body_composition_summary"] = payload["current_shape_summary"]
        payload["recommended_training_focus"] = payload["workout_adjustment"][
            "priority_muscle_groups"
        ]
        return payload

    @staticmethod
    def normalize_assessment_payload(
        raw_analysis: dict[str, Any] | None,
        *,
        role_label: str,
        days_delta: int | None,
    ) -> dict[str, Any]:
        raw = raw_analysis if isinstance(raw_analysis, dict) else {}
        workout_raw = raw.get("workout_adjustment")
        diet_raw = raw.get("diet_adjustment")

        priority_groups: list[str] = []
        if isinstance(workout_raw, dict) and isinstance(
            workout_raw.get("priority_muscle_groups"), list
        ):
            priority_groups = [
                str(m).strip()
                for m in workout_raw["priority_muscle_groups"]
                if str(m).strip()
            ]
        if not priority_groups and isinstance(
            raw.get("recommended_training_focus"), list
        ):
            priority_groups = [
                str(m).strip()
                for m in raw["recommended_training_focus"]
                if str(m).strip()
            ]
        if not priority_groups:
            priority_groups = ["Compound strength & conditioning"]

        default_focus_prompt = (
            f"Prioritize {', '.join(priority_groups[:3])} with disciplined rest "
            "and progressive compound overload."
        )

        workout_adjustment = {
            "priority_muscle_groups": priority_groups[:3],
            "volume_and_density_directive": (
                workout_raw.get("volume_and_density_directive")
                if isinstance(workout_raw, dict)
                and workout_raw.get("volume_and_density_directive")
                else "Complete structured compound sets with controlled rest intervals."
            ),
            "next_session_focus_prompt": (
                workout_raw.get("next_session_focus_prompt")
                if isinstance(workout_raw, dict)
                and workout_raw.get("next_session_focus_prompt")
                else default_focus_prompt
            ),
        }

        diet_adjustment = {
            "caloric_stance": (
                diet_raw.get("caloric_stance")
                if isinstance(diet_raw, dict) and diet_raw.get("caloric_stance")
                else "Goal-aligned energy balance"
            ),
            "protein_and_macro_priority": (
                diet_raw.get("protein_and_macro_priority")
                if isinstance(diet_raw, dict)
                and diet_raw.get("protein_and_macro_priority")
                else "Prioritize daily protein target and steady hydration."
            ),
            "immediate_weekly_habit": (
                diet_raw.get("immediate_weekly_habit")
                if isinstance(diet_raw, dict) and diet_raw.get("immediate_weekly_habit")
                else "Maintain consistent meal timing and whole-food portions this week."
            ),
        }

        return {
            "current_shape_summary": (
                raw.get("current_shape_summary")
                or raw.get("body_composition_summary")
                or raw.get("summary")
                or f"{role_label.capitalize()} physique check-in recorded."
            ),
            "delta_since_last_checkin": (
                raw.get("delta_since_last_checkin")
                or (
                    f"{days_delta} day(s) since prior check-in."
                    if days_delta is not None
                    else "Initial check-in in series."
                )
            ),
            "gap_to_goal": (
                raw.get("gap_to_goal")
                or "Align proportions and conditioning with target goal."
            ),
            "verdict": raw.get("verdict") or CoachingVerdict.STAY_THE_COURSE.value,
            "workout_adjustment": workout_adjustment,
            "diet_adjustment": diet_adjustment,
        }

    @staticmethod
    def build_workout_coaching_context(
        *,
        plan_date: date,
        goal_summary: str,
        preferred_style: str,
        days_per_week: int,
        available_equipment: list[str],
        injuries_or_constraints: str | None,
        adherence_summary: str,
        latest_assessment: dict[str, Any] | None,
        session_request: str | None,
        regenerate: bool,
    ) -> str:
        assessment_context = "No prior physique assessment logged."
        if latest_assessment is not None:
            wa = latest_assessment["workout_adjustment"]
            da = latest_assessment["diet_adjustment"]
            assessment_context = (
                f"Verdict: {latest_assessment['verdict']}\n"
                f"Current Shape: {latest_assessment['current_shape_summary']}\n"
                f"Progress Delta: {latest_assessment['delta_since_last_checkin']}\n"
                f"Gap to Goal: {latest_assessment['gap_to_goal']}\n"
                f"Priority Muscle Groups: {', '.join(wa['priority_muscle_groups'])}\n"
                f"Volume & Density Directive: {wa['volume_and_density_directive']}\n"
                f"Recommended Focus Prompt: {wa['next_session_focus_prompt']}\n"
                f"Diet Stance: {da['caloric_stance']} | {da['protein_and_macro_priority']}"
            )

        return (
            f"Target Date: {plan_date.isoformat()}\n"
            f"Goal & Preferences: {goal_summary}\n"
            f"Training Style: {preferred_style} ({days_per_week} days/week)\n"
            f"Available Equipment: {', '.join(available_equipment) or 'Bodyweight only'}\n"
            f"Injuries / Constraints: {injuries_or_constraints or 'None'}\n"
            f"Recent Adherence: {adherence_summary}\n"
            f"Latest Physique Assessment:\n{assessment_context}\n"
            f"Session Focus Request: {session_request or 'None—apply latest assessment directives and style'}\n"
            f"Regenerate Variation: {'Yes—provide a fresh variation' if regenerate else 'No'}"
        )

    async def evaluate_checkin(
        self,
        *,
        current_webp: bytes,
        previous_webp: bytes | None = None,
        baseline_webp: bytes | None = None,
        goal_summary: str,
        preferred_style: str,
        adherence_summary: str,
        days_since_previous: int | None = None,
    ) -> PhysiqueAssessment:
        context_block = (
            f"ATHLETE GOAL: {goal_summary}\n"
            f"TRAINING STYLE: {preferred_style}\n"
            f"RECENT EXECUTION ADHERENCE: {adherence_summary}\n"
            f"DAYS SINCE LAST CHECK-IN: {days_since_previous if days_since_previous is not None else 'First check-in (Baseline)'}\n\n"
            "Analyze the attached photos and output the structured PhysiqueAssessment."
        )

        content: list[str | BinaryContent] = [
            context_block,
            "CURRENT CHECK-IN PHOTO:",
            BinaryContent(data=current_webp, media_type="image/webp"),
        ]

        if previous_webp:
            content.extend(
                [
                    "PREVIOUS CHECK-IN PHOTO (for short-term delta):",
                    BinaryContent(data=previous_webp, media_type="image/webp"),
                ]
            )

        if baseline_webp:
            content.extend(
                [
                    "BASELINE PHOTO (Day 1 reference):",
                    BinaryContent(data=baseline_webp, media_type="image/webp"),
                ]
            )

        result = await self._assessment_agent.run(content)
        return result.output

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
