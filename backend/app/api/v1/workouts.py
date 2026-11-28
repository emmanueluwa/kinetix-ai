from __future__ import annotations

import os
from typing import Any
from pydantic_ai import Agent

from app.schemas.workout import GeneratedDailyWorkout

WORKOUT_COACH_MODEL = os.getenv("WORKOUT_COACH_MODEL", "google-gla:gemini-3.8-flash")

workout_coach_agent = Agent(
    WORKOUT_COACH_MODEL,
    output_type=GeneratedDailyWorkout,
    system_prompt=(
        "You are an elite strength, calisthenics, and physique coach. "
        "Design a bespoke, high-efficiency daily workout tailored strictly to the athlete's "
        "preferred training style, favorite movements, goal summary, available equipment, "
        "injury constraints, and latest physique check-in analysis. "
        "Prioritize high-return compound movements that deliver maximum stimulus per minute. "
        "If the athlete prefers prison-style calisthenics (e.g., burpees, push-up variations, "
        "squats, pull-ups, dips, core density), build an authentic, challenging bodyweight/calisthenics "
        "session using ladders, supersets, or high-density compound blocks—never force generic gym lifts "
        "they didn't ask for. Never include exercises that aggravate listed injuries. "
        "Always set completed=false on every generated task."
    ),
)


async def generate_bespoke_workout(
    *,
    profile: Any,
    latest_photo_analysis: dict[str, Any] | None = None,
    session_request: str | None = None,
    regenerate: bool = False,
) -> GeneratedDailyWorkout:
    equipment = (
        ", ".join(getattr(profile, "available_equipment", None) or [])
        or "Bodyweight only"
    )
    injuries = getattr(profile, "injuries_or_constraints", None) or "None reported"
    goal = getattr(
        profile, "goal_summary", "Build lean, athletic muscle and conditioning"
    )
    style = getattr(profile, "preferred_style", "calisthenics_prison")
    days = getattr(profile, "days_per_week", 4)

    prompt_parts = [
        f"Goal & Favorite Movements: {goal}",
        f"Preferred Training Style: {style}",
        f"Available Equipment: {equipment}",
        f"Injuries / Constraints: {injuries}",
        f"Schedule: {days} days/week",
    ]

    if latest_photo_analysis:
        prompt_parts.append(
            f"Latest Physique Check-In Critique: {latest_photo_analysis}"
        )

    if session_request:
        prompt_parts.append(f"Athlete Request for Today's Session: {session_request}")

    if regenerate:
        prompt_parts.append(
            "Variation Note: Provide a fresh exercise variation and rep/density structure "
            "different from a standard default session while keeping the same style and constraints."
        )

    result = await workout_coach_agent.run("\n".join(prompt_parts))
    return result.output
