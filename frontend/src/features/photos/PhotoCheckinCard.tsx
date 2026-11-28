"use client";

import React, { useId, useState } from "react";
import { api, type DailyWorkout, type PhotoAnalysis } from "@/lib/api";
import type {
  CoachingVerdict,
  DietAdjustment,
  PhysiqueAssessment,
  WorkoutAdjustment,
} from "./api";

interface LegacyCritiquePayload {
  overall_trajectory_score?: number;
  body_composition_summary?: string;
  recommended_training_focus?: string[];
  current_shape_summary?: string;
  delta_since_last_checkin?: string;
  gap_to_goal?: string;
  verdict?: CoachingVerdict;
  workout_adjustment?: Partial<WorkoutAdjustment>;
  diet_adjustment?: Partial<DietAdjustment>;
}

const VALID_VERDICTS: ReadonlySet<CoachingVerdict> = new Set([
  "stay_the_course",
  "tighten_nutrition",
  "increase_fuel",
  "pivot_volume",
  "deload_recover",
]);

const VERDICT_LABELS: Record<CoachingVerdict, string> = {
  stay_the_course: "Stay The Course",
  tighten_nutrition: "Tighten Nutrition",
  increase_fuel: "Increase Fuel",
  pivot_volume: "Pivot Volume",
  deload_recover: "Deload & Recover",
};

function extractStructuredAssessment(
  raw: Record<string, unknown> | null,
): PhysiqueAssessment | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const data = raw as LegacyCritiquePayload;
  const workoutRaw = data.workout_adjustment;
  const dietRaw = data.diet_adjustment;

  const priorityGroups = Array.isArray(workoutRaw?.priority_muscle_groups)
    ? workoutRaw.priority_muscle_groups.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : Array.isArray(data.recommended_training_focus)
      ? data.recommended_training_focus.filter(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0,
        )
      : [];

  const volumeDirective =
    typeof workoutRaw?.volume_and_density_directive === "string" &&
    workoutRaw.volume_and_density_directive.trim().length > 0
      ? workoutRaw.volume_and_density_directive.trim()
      : priorityGroups.length > 0
        ? `Prioritize ${priorityGroups.join(", ")} with disciplined rest and progressive overload.`
        : "";

  const focusPrompt =
    typeof workoutRaw?.next_session_focus_prompt === "string" &&
    workoutRaw.next_session_focus_prompt.trim().length > 0
      ? workoutRaw.next_session_focus_prompt.trim()
      : priorityGroups.length > 0
        ? `Focus next session on ${priorityGroups.join(", ")} aligned with current physique check-in.`
        : "";

  const caloricStance =
    typeof dietRaw?.caloric_stance === "string" &&
    dietRaw.caloric_stance.trim().length > 0
      ? dietRaw.caloric_stance.trim()
      : "";

  const macroPriority =
    typeof dietRaw?.protein_and_macro_priority === "string" &&
    dietRaw.protein_and_macro_priority.trim().length > 0
      ? dietRaw.protein_and_macro_priority.trim()
      : "";

  const weeklyHabit =
    typeof dietRaw?.immediate_weekly_habit === "string" &&
    dietRaw.immediate_weekly_habit.trim().length > 0
      ? dietRaw.immediate_weekly_habit.trim()
      : "";

  const hasWorkout =
    priorityGroups.length > 0 ||
    volumeDirective.length > 0 ||
    focusPrompt.length > 0;
  const hasDiet =
    caloricStance.length > 0 ||
    macroPriority.length > 0 ||
    weeklyHabit.length > 0;

  if (!hasWorkout && !hasDiet && !data.body_composition_summary) {
    return null;
  }

  const verdict: CoachingVerdict =
    data.verdict && VALID_VERDICTS.has(data.verdict)
      ? data.verdict
      : "stay_the_course";

  return {
    current_shape_summary:
      typeof data.current_shape_summary === "string" &&
      data.current_shape_summary.trim().length > 0
        ? data.current_shape_summary.trim()
        : typeof data.body_composition_summary === "string" &&
            data.body_composition_summary.trim().length > 0
          ? data.body_composition_summary.trim()
          : "Current check-in evaluated.",
    delta_since_last_checkin:
      typeof data.delta_since_last_checkin === "string" &&
      data.delta_since_last_checkin.trim().length > 0
        ? data.delta_since_last_checkin.trim()
        : "Compared against prior check-in and baseline.",
    gap_to_goal:
      typeof data.gap_to_goal === "string" && data.gap_to_goal.trim().length > 0
        ? data.gap_to_goal.trim()
        : "Aligned with stated physique goal.",
    verdict,
    workout_adjustment: {
      priority_muscle_groups:
        priorityGroups.length > 0 ? priorityGroups : ["Full Body"],
      volume_and_density_directive:
        volumeDirective ||
        "Maintain structured compound sets and clean rest intervals.",
      next_session_focus_prompt:
        focusPrompt ||
        "Generate a focused session targeting current physique priorities.",
    },
    diet_adjustment: {
      caloric_stance: caloricStance || "Goal-aligned energy balance",
      protein_and_macro_priority:
        macroPriority ||
        "Prioritize daily protein target and steady hydration.",
      immediate_weekly_habit:
        weeklyHabit ||
        "Keep consistent meal timing and whole-food portions this week.",
    },
  };
}

export interface PhotoCheckinCardProps {
  token: string | null;
  onStatusChange: (msg: string) => void;
  onError: (msg: string | null) => void;
  onPhotoProcessed: () => Promise<void> | void;
  onApplyWorkoutFocus?: (focusPrompt: string) => Promise<DailyWorkout | void>;
}

export function PhotoCheckinCard({
  token,
  onStatusChange,
  onError,
  onPhotoProcessed,
  onApplyWorkoutFocus,
}: PhotoCheckinCardProps) {
  const titleId = useId();
  const [photoRole, setPhotoRole] = useState<"baseline" | "goal" | "progress">(
    "baseline",
  );
  const [weightKg, setWeightKg] = useState("");
  const [userNotes, setUserNotes] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [processingPhoto, setProcessingPhoto] = useState(false);
  const [applyingWorkout, setApplyingWorkout] = useState(false);
  const [photoResult, setPhotoResult] = useState<PhotoAnalysis | null>(null);

  async function handleProcessPhoto(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !selectedFile || processingPhoto) {
      return;
    }

    setProcessingPhoto(true);
    onError(null);
    setPhotoResult(null);

    try {
      const contentType =
        selectedFile.type === "image/png" || selectedFile.type === "image/webp"
          ? selectedFile.type
          : "image/jpeg";

      onStatusChange("Requesting upload URL...");
      const presigned = await api.presignPhoto(token, contentType);

      onStatusChange("Uploading photo...");
      const uploadRes = await fetch(presigned.upload_url, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: selectedFile,
      });
      if (!uploadRes.ok) {
        throw new Error(
          `Upload failed (${uploadRes.status}). Check R2 CORS and credentials.`,
        );
      }

      onStatusChange("Aligning pose & analyzing...");
      const parsedWeight = weightKg.trim() ? Number(weightKg) : null;
      const validWeight =
        parsedWeight !== null &&
        Number.isFinite(parsedWeight) &&
        parsedWeight > 0
          ? parsedWeight
          : null;

      const analysis = await api.processPhoto(token, {
        object_key: presigned.object_key,
        role: photoRole,
        weight_kg: validWeight,
        user_notes: userNotes.trim() || null,
      });

      setPhotoResult(analysis);
      await onPhotoProcessed();
      onStatusChange("Photo ready");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Photo processing failed");
      onStatusChange("Photo error");
    } finally {
      setProcessingPhoto(false);
    }
  }

  async function handleApplyFocus(focusPrompt: string) {
    if (!onApplyWorkoutFocus || applyingWorkout) {
      return;
    }

    setApplyingWorkout(true);
    onError(null);
    onStatusChange("Applying check-in focus to next workout...");

    try {
      const updated = await onApplyWorkoutFocus(focusPrompt);
      onStatusChange(
        updated?.focus_area
          ? `Workout updated: ${updated.focus_area}`
          : "Next workout updated from check-in",
      );
    } catch (err) {
      onError(
        err instanceof Error
          ? err.message
          : "Failed to apply check-in focus to workout",
      );
      onStatusChange("Workout error");
    } finally {
      setApplyingWorkout(false);
    }
  }

  const rawCritique = (photoResult?.ai_analysis ??
    null) as LegacyCritiquePayload | null;
  const structuredAssessment = extractStructuredAssessment(
    photoResult?.ai_analysis ?? null,
  );

  return (
    <section
      aria-labelledby={titleId}
      className="bg-zinc-900/70 border border-zinc-800 rounded-2xl p-4 sm:p-6 space-y-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id={titleId} className="text-base sm:text-lg font-semibold">
          Check-In Photo &amp; Pose
        </h2>
        <span className="text-[11px] font-mono text-zinc-400">
          MediaPipe + R2
        </span>
      </div>

      <form onSubmit={handleProcessPhoto} className="space-y-3.5 text-sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="checkin-photo-role"
              className="block text-xs text-zinc-400 mb-1"
            >
              Photo Type
            </label>
            <select
              id="checkin-photo-role"
              value={photoRole}
              onChange={(e) =>
                setPhotoRole(e.target.value as "baseline" | "goal" | "progress")
              }
              className="w-full min-h-11 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-base sm:text-sm"
            >
              <option value="baseline">Baseline</option>
              <option value="goal">Goal Reference</option>
              <option value="progress">Progress Check-In</option>
            </select>
          </div>
          <div>
            <label
              htmlFor="checkin-weight-kg"
              className="block text-xs text-zinc-400 mb-1"
            >
              Weight (kg)
            </label>
            <input
              id="checkin-weight-kg"
              type="number"
              inputMode="decimal"
              step="0.1"
              value={weightKg}
              onChange={(e) => setWeightKg(e.target.value)}
              placeholder="78.5"
              className="w-full min-h-11 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-base sm:text-sm"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="checkin-notes"
            className="block text-xs text-zinc-400 mb-1"
          >
            Notes (optional)
          </label>
          <input
            id="checkin-notes"
            type="text"
            value={userNotes}
            onChange={(e) => setUserNotes(e.target.value)}
            placeholder="Morning check-in, lighting notes"
            className="w-full min-h-11 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-base sm:text-sm"
          />
        </div>

        <div>
          <label
            htmlFor="checkin-file-input"
            className="block text-xs text-zinc-400 mb-1"
          >
            Choose Photo
          </label>
          <input
            id="checkin-file-input"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
            className="w-full text-xs text-zinc-400 file:mr-3 file:min-h-10 file:px-3.5 file:py-2 file:rounded-xl file:border-0 file:bg-zinc-800 file:text-zinc-100 hover:file:bg-zinc-700"
            required
          />
        </div>

        <button
          type="submit"
          disabled={!token || !selectedFile || processingPhoto}
          className="w-full min-h-12 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-zinc-950 font-semibold px-4 py-2.5 rounded-xl transition cursor-pointer"
        >
          {processingPhoto
            ? "Aligning & Analyzing..."
            : "Upload & Process Photo"}
        </button>
      </form>

      {photoResult && (
        <div className="border-t border-zinc-800 pt-4 space-y-4">
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="bg-zinc-950 border border-zinc-800 p-2.5 rounded-xl">
              <div className="text-zinc-400">Pose</div>
              <div className="font-mono font-semibold text-sm mt-0.5">
                {photoResult.pose_detected ? "Detected" : "Fallback"}
              </div>
            </div>
            <div className="bg-zinc-950 border border-zinc-800 p-2.5 rounded-xl">
              <div className="text-zinc-400">Shoulder:Waist</div>
              <div className="font-mono font-semibold text-sm mt-0.5">
                {photoResult.shoulder_to_waist_ratio ?? "N/A"}
              </div>
            </div>
            <div className="bg-zinc-950 border border-zinc-800 p-2.5 rounded-xl">
              <div className="text-zinc-400">Waist:Hip</div>
              <div className="font-mono font-semibold text-sm mt-0.5">
                {photoResult.waist_to_hip_ratio ?? "N/A"}
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 items-center sm:items-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoResult.aligned_preview_url}
              alt="Pose-aligned physique preview"
              className="w-full max-w-56 sm:w-36 aspect-[3/4] object-cover rounded-xl border border-zinc-700 bg-zinc-950 shrink-0"
            />

            {structuredAssessment ? (
              <div className="space-y-3 text-xs sm:text-sm w-full">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-emerald-400">
                    Verdict: {VERDICT_LABELS[structuredAssessment.verdict]}
                  </span>
                  {typeof rawCritique?.overall_trajectory_score ===
                    "number" && (
                    <span className="font-mono text-xs text-zinc-300 bg-zinc-950 border border-zinc-800 px-2.5 py-1 rounded-lg">
                      Score: {rawCritique.overall_trajectory_score}/100
                    </span>
                  )}
                </div>

                <p className="text-zinc-300 leading-relaxed">
                  {structuredAssessment.current_shape_summary}
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                  <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 space-y-1">
                    <div className="font-semibold text-zinc-200">
                      Workout Adjustment
                    </div>
                    <p className="text-zinc-300 leading-relaxed">
                      {
                        structuredAssessment.workout_adjustment
                          .volume_and_density_directive
                      }
                    </p>
                    <div className="flex flex-wrap gap-1 pt-1">
                      {structuredAssessment.workout_adjustment.priority_muscle_groups.map(
                        (muscle) => (
                          <span
                            key={muscle}
                            className="bg-emerald-950/80 border border-emerald-800 text-emerald-300 px-2 py-0.5 rounded-md text-[11px]"
                          >
                            {muscle}
                          </span>
                        ),
                      )}
                    </div>
                  </div>

                  <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 space-y-1">
                    <div className="font-semibold text-zinc-200">
                      Diet Adjustment
                    </div>
                    <p className="text-sky-300 font-medium">
                      {structuredAssessment.diet_adjustment.caloric_stance}
                    </p>
                    <p className="text-zinc-300 leading-relaxed">
                      {
                        structuredAssessment.diet_adjustment
                          .protein_and_macro_priority
                      }
                    </p>
                    <p className="text-zinc-400 leading-relaxed">
                      Habit:{" "}
                      {
                        structuredAssessment.diet_adjustment
                          .immediate_weekly_habit
                      }
                    </p>
                  </div>
                </div>

                {onApplyWorkoutFocus && (
                  <button
                    type="button"
                    disabled={!token || applyingWorkout}
                    onClick={() =>
                      handleApplyFocus(
                        structuredAssessment.workout_adjustment
                          .next_session_focus_prompt,
                      )
                    }
                    className="w-full min-h-11 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-zinc-950 font-semibold px-4 py-2 rounded-xl transition cursor-pointer"
                  >
                    {applyingWorkout
                      ? "Updating Next Workout..."
                      : "Apply to Next Workout"}
                  </button>
                )}
              </div>
            ) : rawCritique ? (
              <div className="space-y-2 text-xs sm:text-sm w-full">
                {typeof rawCritique.overall_trajectory_score === "number" && (
                  <div className="font-semibold text-emerald-400">
                    Goal Alignment Score: {rawCritique.overall_trajectory_score}
                    /100
                  </div>
                )}
                {rawCritique.body_composition_summary && (
                  <p className="text-zinc-300 leading-relaxed">
                    {rawCritique.body_composition_summary}
                  </p>
                )}
                {rawCritique.recommended_training_focus && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {rawCritique.recommended_training_focus.map((area) => (
                      <span
                        key={area}
                        className="bg-emerald-950/80 border border-emerald-800 text-emerald-300 px-2.5 py-1 rounded-lg text-xs"
                      >
                        {area}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-zinc-400 leading-relaxed">
                Reference photo saved and pose-aligned. Upload a{" "}
                <strong className="text-zinc-200">Progress Check-In</strong>{" "}
                photo next for AI comparison feedback.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
