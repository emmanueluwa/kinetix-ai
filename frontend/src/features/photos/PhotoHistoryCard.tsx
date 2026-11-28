"use client";

import React, { useCallback, useEffect, useId, useMemo, useState } from "react";
import type { DailyWorkout } from "@/lib/api";
import {
  fetchPhotoHistory,
  type CoachingVerdict,
  type PhotoCheckIn,
} from "./api";

type CompareReferenceMode = "baseline" | "previous";

interface VerdictBadgeConfig {
  label: string;
  classes: string;
}

const VERDICT_BADGES: Record<CoachingVerdict, VerdictBadgeConfig> = {
  stay_the_course: {
    label: "Stay The Course",
    classes: "border-emerald-500/35 bg-emerald-500/15 text-emerald-300",
  },
  tighten_nutrition: {
    label: "Tighten Nutrition",
    classes: "border-amber-500/35 bg-amber-500/15 text-amber-300",
  },
  increase_fuel: {
    label: "Increase Fuel",
    classes: "border-sky-500/35 bg-sky-500/15 text-sky-300",
  },
  pivot_volume: {
    label: "Pivot Volume",
    classes: "border-violet-500/35 bg-violet-500/15 text-violet-300",
  },
  deload_recover: {
    label: "Deload & Recover",
    classes: "border-rose-500/35 bg-rose-500/15 text-rose-300",
  },
};

function formatCheckinDate(isoString: string): string {
  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) {
    return isoString;
  }
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatStripDate(isoString: string): string {
  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) {
    return isoString;
  }
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatPoseName(rawPose: string): string {
  return rawPose.replaceAll("_", " ").trim() || "check-in";
}

export interface PhotoHistoryCardProps {
  token: string | null;
  refreshTrigger?: number;
  onStatusChange: (msg: string) => void;
  onError: (msg: string | null) => void;
  onApplyWorkoutFocus: (focusPrompt: string) => Promise<DailyWorkout | void>;
}

export function PhotoHistoryCard({
  token,
  refreshTrigger = 0,
  onStatusChange,
  onError,
  onApplyWorkoutFocus,
}: PhotoHistoryCardProps) {
  const headingId = useId();
  const [checkins, setCheckins] = useState<PhotoCheckIn[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareMode, setCompareMode] =
    useState<CompareReferenceMode>("baseline");
  const [splitCompare, setSplitCompare] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [applyingFocus, setApplyingFocus] = useState(false);
  const [historyEmptyMessage, setHistoryEmptyMessage] = useState<string | null>(
    null,
  );

  const loadHistory = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoadingHistory(true);
    setHistoryEmptyMessage(null);
    try {
      const response = await fetchPhotoHistory(token, "asc", 50);
      setCheckins(response.checkins);
      setSelectedId((currentSelected) => {
        if (
          currentSelected &&
          response.checkins.some((item) => item.id === currentSelected)
        ) {
          return currentSelected;
        }
        return response.checkins.length > 0
          ? response.checkins[response.checkins.length - 1].id
          : null;
      });
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Unable to load photo check-in history.";
      if (message.includes("(404)")) {
        setCheckins([]);
        setHistoryEmptyMessage(
          "Photo history endpoint is not yet active on the backend.",
        );
      } else {
        onError(message);
      }
    } finally {
      setLoadingHistory(false);
    }
  }, [onError, token]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory, refreshTrigger]);

  const selectedIndex = useMemo(() => {
    if (checkins.length === 0) {
      return -1;
    }
    const foundIdx = checkins.findIndex((item) => item.id === selectedId);
    return foundIdx >= 0 ? foundIdx : checkins.length - 1;
  }, [checkins, selectedId]);

  const activeCheckin = selectedIndex >= 0 ? checkins[selectedIndex] : null;

  const referenceCheckin = useMemo(() => {
    if (!activeCheckin || selectedIndex <= 0) {
      return null;
    }
    if (compareMode === "baseline") {
      return checkins[0].id !== activeCheckin.id ? checkins[0] : null;
    }
    return checkins[selectedIndex - 1] ?? null;
  }, [activeCheckin, checkins, compareMode, selectedIndex]);

  async function handleApplyFocus(focusPrompt: string) {
    if (!token || applyingFocus) {
      return;
    }
    setApplyingFocus(true);
    onError(null);
    onStatusChange("Generating workout from check-in focus...");
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
      setApplyingFocus(false);
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      className="bg-zinc-900/70 border border-zinc-800 rounded-2xl p-4 sm:p-6 space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id={headingId} className="text-base sm:text-lg font-semibold">
            Check-In Timeline &amp; Adjustments
          </h2>
          <p className="text-xs text-zinc-400">
            Compare progress against baseline or prior check-ins and apply
            training + diet shifts
          </p>
        </div>

        <div className="flex items-center gap-2">
          {referenceCheckin && (
            <button
              type="button"
              onClick={() => setSplitCompare((prev) => !prev)}
              className="min-h-10 rounded-xl border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-100 transition cursor-pointer"
            >
              {splitCompare ? "Single Photo" : "Compare Photos"}
            </button>
          )}
          <button
            type="button"
            disabled={!token || loadingHistory}
            onClick={() => void loadHistory()}
            className="min-h-10 rounded-xl border border-zinc-800 bg-zinc-950 hover:bg-zinc-800 disabled:opacity-50 px-3 py-1.5 text-xs font-mono text-zinc-300 transition cursor-pointer"
          >
            {loadingHistory ? "Syncing..." : "Refresh"}
          </button>
        </div>
      </div>

      {loadingHistory && checkins.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-6 text-center text-xs text-zinc-400">
          Loading physique check-in history...
        </div>
      ) : historyEmptyMessage ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 text-xs text-zinc-400 leading-relaxed">
          {historyEmptyMessage}
        </div>
      ) : checkins.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 text-xs text-zinc-400 leading-relaxed">
          No check-in history logged yet. Complete a check-in above to start
          tracking shape deltas, workout pivots, and dietary adjustments.
        </div>
      ) : (
        <>
          {/* Timeline Strip & Reference Mode */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/90 p-3 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-mono text-zinc-400">
                {checkins.length} check-{checkins.length === 1 ? "in" : "ins"}
              </span>
              <div
                role="group"
                aria-label="Comparison reference"
                className="flex items-center gap-1 rounded-lg bg-zinc-900 border border-zinc-800 p-1 text-xs"
              >
                <button
                  type="button"
                  onClick={() => setCompareMode("baseline")}
                  className={`rounded-md px-2.5 py-1 transition cursor-pointer ${
                    compareMode === "baseline"
                      ? "bg-zinc-700 text-white font-medium"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  vs. Baseline
                </button>
                <button
                  type="button"
                  onClick={() => setCompareMode("previous")}
                  className={`rounded-md px-2.5 py-1 transition cursor-pointer ${
                    compareMode === "previous"
                      ? "bg-zinc-700 text-white font-medium"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  vs. Previous
                </button>
              </div>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1">
              {checkins.map((item, idx) => {
                const isSelected = activeCheckin?.id === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className={`flex shrink-0 items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition cursor-pointer ${
                      isSelected
                        ? "border-sky-400 bg-zinc-900 text-white"
                        : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.preview_url}
                      alt={`Check-in ${idx + 1} from ${formatStripDate(item.created_at)}`}
                      loading="lazy"
                      className="h-10 w-8 rounded-md object-cover border border-zinc-800 bg-zinc-900"
                    />
                    <div className="text-xs">
                      <div className="font-medium">
                        {formatStripDate(item.created_at)}
                      </div>
                      <div className="text-[11px] font-mono text-zinc-400">
                        {idx === 0 ? "Day 1" : `#${idx + 1}`}
                        {item.days_since_previous !== null && idx > 0
                          ? ` (+${item.days_since_previous}d)`
                          : ""}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Check-In Detail */}
          {activeCheckin && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-white">
                    {formatCheckinDate(activeCheckin.created_at)}
                  </span>
                  <span className="rounded-md bg-zinc-900 border border-zinc-800 px-2 py-0.5 text-xs font-mono text-zinc-300">
                    {formatPoseName(activeCheckin.pose_label)}
                  </span>
                </div>
                <span
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${
                    VERDICT_BADGES[activeCheckin.assessment.verdict].classes
                  }`}
                >
                  {VERDICT_BADGES[activeCheckin.assessment.verdict].label}
                </span>
              </div>

              {activeCheckin.notes && (
                <p className="text-xs text-zinc-400 leading-relaxed">
                  {activeCheckin.notes}
                </p>
              )}

              {splitCompare && referenceCheckin ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <figure className="space-y-1.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={referenceCheckin.preview_url}
                      alt={`Reference check-in from ${formatCheckinDate(referenceCheckin.created_at)}`}
                      loading="lazy"
                      className="aspect-[3/4] w-full rounded-xl border border-zinc-800 bg-zinc-900 object-cover"
                    />
                    <figcaption className="text-center text-xs text-zinc-400">
                      {compareMode === "baseline" ? "Baseline" : "Previous"}:{" "}
                      {formatCheckinDate(referenceCheckin.created_at)}
                    </figcaption>
                  </figure>
                  <figure className="space-y-1.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={activeCheckin.preview_url}
                      alt={`Selected check-in from ${formatCheckinDate(activeCheckin.created_at)}`}
                      loading="lazy"
                      className="aspect-[3/4] w-full rounded-xl border border-zinc-800 bg-zinc-900 object-cover"
                    />
                    <figcaption className="text-center text-xs font-medium text-zinc-200">
                      Selected: {formatCheckinDate(activeCheckin.created_at)}
                    </figcaption>
                  </figure>
                </div>
              ) : (
                <figure className="space-y-1.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={activeCheckin.preview_url}
                    alt={`Physique check-in from ${formatCheckinDate(activeCheckin.created_at)}`}
                    loading="lazy"
                    className="max-h-96 w-full rounded-xl border border-zinc-800 bg-zinc-900 object-cover"
                  />
                </figure>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-xs">
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-3 space-y-1">
                  <div className="font-mono uppercase text-[11px] text-zinc-400">
                    Current Shape
                  </div>
                  <p className="text-zinc-200 leading-relaxed">
                    {activeCheckin.assessment.current_shape_summary}
                  </p>
                </div>

                <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-3 space-y-1">
                  <div className="font-mono uppercase text-[11px] text-zinc-400">
                    Progress Delta
                  </div>
                  <p className="text-zinc-200 leading-relaxed">
                    {activeCheckin.assessment.delta_since_last_checkin}
                  </p>
                </div>

                <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-3 space-y-1">
                  <div className="font-mono uppercase text-[11px] text-zinc-400">
                    Gap To Goal
                  </div>
                  <p className="text-zinc-200 leading-relaxed">
                    {activeCheckin.assessment.gap_to_goal}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs">
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/90 p-3.5 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold text-white">
                      Workout Adjustment
                    </h3>
                    <div className="flex flex-wrap gap-1">
                      {activeCheckin.assessment.workout_adjustment.priority_muscle_groups.map(
                        (muscle) => (
                          <span
                            key={muscle}
                            className="rounded-md bg-emerald-950/90 border border-emerald-800 px-2 py-0.5 text-[11px] text-emerald-300"
                          >
                            {muscle}
                          </span>
                        ),
                      )}
                    </div>
                  </div>
                  <p className="text-zinc-200 leading-relaxed">
                    {
                      activeCheckin.assessment.workout_adjustment
                        .volume_and_density_directive
                    }
                  </p>
                  <p className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-zinc-300 leading-relaxed">
                    <span className="font-medium text-zinc-100">
                      Focus Prompt:{" "}
                    </span>
                    {
                      activeCheckin.assessment.workout_adjustment
                        .next_session_focus_prompt
                    }
                  </p>
                  <button
                    type="button"
                    disabled={!token || applyingFocus}
                    onClick={() =>
                      handleApplyFocus(
                        activeCheckin.assessment.workout_adjustment
                          .next_session_focus_prompt,
                      )
                    }
                    className="w-full min-h-11 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-zinc-950 font-semibold px-4 py-2 transition cursor-pointer"
                  >
                    {applyingFocus
                      ? "Generating Tailored Workout..."
                      : "Apply to Next Workout"}
                  </button>
                </div>

                <div className="rounded-xl border border-zinc-800 bg-zinc-900/90 p-3.5 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold text-white">
                      Diet Adjustment
                    </h3>
                    <span className="rounded-md bg-sky-950/90 border border-sky-800 px-2.5 py-0.5 text-xs font-medium text-sky-300">
                      {activeCheckin.assessment.diet_adjustment.caloric_stance}
                    </span>
                  </div>
                  <p className="text-zinc-200 leading-relaxed">
                    <span className="font-medium text-zinc-400">
                      Protein &amp; Macros:{" "}
                    </span>
                    {
                      activeCheckin.assessment.diet_adjustment
                        .protein_and_macro_priority
                    }
                  </p>
                  <p className="text-zinc-200 leading-relaxed">
                    <span className="font-medium text-zinc-400">
                      7-Day Habit:{" "}
                    </span>
                    {
                      activeCheckin.assessment.diet_adjustment
                        .immediate_weekly_habit
                    }
                  </p>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
