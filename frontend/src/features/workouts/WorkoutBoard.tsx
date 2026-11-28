"use client";

import { useState } from "react";
import { api, DailyWorkout } from "@/lib/api";

interface WorkoutBoardProps {
  token: string | null;
  onStatusChange: (msg: string) => void;
  onError: (msg: string | null) => void;
}

export function WorkoutBoard({
  token,
  onStatusChange,
  onError,
}: WorkoutBoardProps) {
  const [workout, setWorkout] = useState<DailyWorkout | null>(null);
  const [sessionFocus, setSessionFocus] = useState("");
  const [loadingWorkout, setLoadingWorkout] = useState(false);
  const [togglingTaskIdx, setTogglingTaskIdx] = useState<number | null>(null);

  async function handleGenerateWorkout(regenerate: boolean) {
    if (!token) return;
    setLoadingWorkout(true);
    onError(null);
    onStatusChange(
      regenerate
        ? "Regenerating bespoke plan..."
        : "Generating bespoke plan...",
    );
    try {
      const plan = await api.generateWorkout(token, regenerate, sessionFocus);
      setWorkout(plan);
      onStatusChange("Workout ready");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Workout generation failed");
    } finally {
      setLoadingWorkout(false);
    }
  }

  async function handleToggleTask(taskIndex: number, nextCompleted: boolean) {
    const workoutId = workout?.plan_id ?? workout?.id;
    if (!token || !workout || !workoutId) return;

    const previousWorkout = workout;
    setWorkout({
      ...workout,
      tasks: workout.tasks.map((item, idx) =>
        idx === taskIndex ? { ...item, completed: nextCompleted } : item,
      ),
    });

    setTogglingTaskIdx(taskIndex);
    onError(null);
    try {
      const updated = await api.patchWorkoutTask(
        token,
        workoutId,
        taskIndex,
        nextCompleted,
      );
      setWorkout(updated);
      onStatusChange(nextCompleted ? "Task completed" : "Task unmarked");
    } catch (err) {
      setWorkout(previousWorkout);
      onError(err instanceof Error ? err.message : "Failed to update task");
    } finally {
      setTogglingTaskIdx(null);
    }
  }

  const completedCount = workout
    ? workout.tasks.filter((t) => Boolean(t.completed)).length
    : 0;

  return (
    <section className="bg-zinc-900/70 border border-zinc-800 rounded-2xl p-4 sm:p-6 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base sm:text-lg font-semibold">
            Today&apos;s Workout
          </h2>
          <p className="text-xs text-zinc-400">
            Bespoke compound &amp; style-matched session built from your profile
            and check-ins
          </p>
        </div>
        <div className="grid grid-cols-2 sm:flex gap-2">
          <button
            type="button"
            disabled={!token || loadingWorkout}
            onClick={() => handleGenerateWorkout(false)}
            className="min-h-11 bg-zinc-100 hover:bg-white disabled:opacity-50 text-zinc-950 text-sm font-semibold px-4 py-2 rounded-xl transition cursor-pointer"
          >
            {loadingWorkout ? "Generating..." : "Today's Plan"}
          </button>
          <button
            type="button"
            disabled={!token || loadingWorkout}
            onClick={() => handleGenerateWorkout(true)}
            className="min-h-11 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200 text-sm px-3.5 py-2 rounded-xl transition cursor-pointer"
          >
            Regenerate
          </button>
        </div>
      </div>

      <div>
        <label
          htmlFor="session-focus-input"
          className="block text-xs text-zinc-400 mb-1"
        >
          Today&apos;s Session Focus (optional)
        </label>
        <input
          id="session-focus-input"
          type="text"
          value={sessionFocus}
          onChange={(e) => setSessionFocus(e.target.value)}
          placeholder="e.g. prison-style burpee & push-up ladder, high-density compounds, 25 mins"
          className="w-full min-h-11 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-base sm:text-sm"
        />
      </div>

      {workout && (
        <div className="space-y-3.5">
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <div className="text-xs font-mono text-emerald-400 uppercase">
                {workout.plan_date} &bull; {workout.focus_area}
              </div>
              <p className="text-sm text-zinc-300 mt-1 leading-relaxed">
                {workout.rationale}
              </p>
            </div>
            <div className="text-xs font-mono bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-lg self-start sm:self-center shrink-0">
              {completedCount} / {workout.tasks.length} done
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {workout.tasks.map((task, idx) => {
              const isDone = Boolean(task.completed);
              return (
                <div
                  key={`${task.exercise_name}-${idx}`}
                  className={`border rounded-xl p-3.5 sm:p-4 space-y-2 transition ${
                    isDone
                      ? "bg-emerald-950/20 border-emerald-900/70"
                      : "bg-zinc-950/90 border-zinc-800"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <label className="flex items-start gap-3 min-h-11 cursor-pointer select-none flex-1">
                      <input
                        type="checkbox"
                        checked={isDone}
                        disabled={togglingTaskIdx === idx}
                        onChange={(e) =>
                          handleToggleTask(idx, e.target.checked)
                        }
                        className="mt-0.5 h-5 w-5 rounded accent-emerald-500 cursor-pointer shrink-0"
                      />
                      <span
                        className={`font-semibold text-sm leading-snug ${
                          isDone
                            ? "line-through text-zinc-400"
                            : "text-zinc-100"
                        }`}
                      >
                        {idx + 1}. {task.exercise_name}
                      </span>
                    </label>
                    <span className="text-xs font-mono bg-zinc-900 border border-zinc-700 px-2 py-0.5 rounded-lg shrink-0">
                      {task.sets} &times; {task.rep_range}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-400 leading-relaxed pl-8">
                    Target:{" "}
                    <span className="text-zinc-300">{task.target_muscle}</span>{" "}
                    &bull; Equip:{" "}
                    <span className="text-zinc-300">{task.equipment_used}</span>{" "}
                    &bull; Rest:{" "}
                    <span className="text-zinc-300">{task.rest_seconds}s</span>
                  </div>
                  <p className="text-xs text-emerald-300/90 leading-relaxed pl-8">
                    Cue: {task.execution_cue}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
