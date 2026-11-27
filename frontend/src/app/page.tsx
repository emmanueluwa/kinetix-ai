"use client";

import { useEffect, useState } from "react";
import {
  api,
  DailyWorkout,
  fetchDevToken,
  PhotoAnalysis,
  UserProfile,
} from "@/lib/api";

interface CritiquePayload {
  overall_trajectory_score?: number;
  body_composition_summary?: string;
  pose_and_lighting_caveats?: string;
  muscle_assessments?: Array<{
    muscle_group: string;
    visual_progress_notes: string;
    priority_level: string;
  }>;
  recommended_training_focus?: string[];
}

export default function KinetixDashboard() {
  const [token, setToken] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string>(
    "Connecting to FastAPI...",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Profile state
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [goalSummary, setGoalSummary] = useState("");
  const [preferredStyle, setPreferredStyle] = useState("hypertrophy");
  const [equipmentInput, setEquipmentInput] = useState("");
  const [injuries, setInjuries] = useState("");
  const [daysPerWeek, setDaysPerWeek] = useState(4);
  const [savingProfile, setSavingProfile] = useState(false);

  // Photo upload & analysis state
  const [photoRole, setPhotoRole] = useState<"baseline" | "goal" | "progress">(
    "baseline",
  );
  const [weightKg, setWeightKg] = useState<string>("");
  const [userNotes, setUserNotes] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [processingPhoto, setProcessingPhoto] = useState(false);
  const [photoResult, setPhotoResult] = useState<PhotoAnalysis | null>(null);

  // Workout state
  const [workout, setWorkout] = useState<DailyWorkout | null>(null);
  const [loadingWorkout, setLoadingWorkout] = useState(false);

  useEffect(() => {
    let active = true;
    async function init() {
      try {
        const jwt = await fetchDevToken();
        if (!active) return;
        setToken(jwt);
        setStatusMsg("Connected (Dev JWT active)");

        const prof = await api.getProfile(jwt);
        if (!active) return;
        setProfile(prof);
        setGoalSummary(prof.goal_summary);
        setPreferredStyle(prof.preferred_style);
        setEquipmentInput(prof.available_equipment.join(", "));
        setInjuries(prof.injuries_or_constraints ?? "");
        setDaysPerWeek(prof.days_per_week);
      } catch (err) {
        if (!active) return;
        setErrorMsg(
          err instanceof Error ? err.message : "Failed to initialize session",
        );
        setStatusMsg("Disconnected");
      }
    }
    init();
    return () => {
      active = false;
    };
  }, []);

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSavingProfile(true);
    setErrorMsg(null);
    try {
      const updated = await api.saveProfile(token, {
        goal_summary: goalSummary,
        preferred_style: preferredStyle,
        available_equipment: equipmentInput
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        injuries_or_constraints: injuries.trim() || null,
        days_per_week: daysPerWeek,
      });
      setProfile(updated);
      setStatusMsg("Profile saved");
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to save profile",
      );
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleProcessPhoto(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !selectedFile) return;
    setProcessingPhoto(true);
    setErrorMsg(null);
    setPhotoResult(null);

    try {
      const contentType =
        selectedFile.type === "image/png" || selectedFile.type === "image/webp"
          ? selectedFile.type
          : "image/jpeg";

      // 1. Request presigned S3/R2 upload URL
      setStatusMsg("Requesting presigned upload URL...");
      const presigned = await api.presignPhoto(token, contentType);

      // 2. Upload directly to object storage
      setStatusMsg("Uploading photo to object storage...");
      const uploadRes = await fetch(presigned.upload_url, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: selectedFile,
      });
      if (!uploadRes.ok) {
        throw new Error(
          `Direct storage PUT failed (${uploadRes.status}). Check S3/R2 CORS & credentials.`,
        );
      }

      // 3. Trigger EXIF stripping, MediaPipe alignment, and PydanticAI critique
      setStatusMsg("Running MediaPipe pose alignment & AI analysis...");
      const analysis = await api.processPhoto(token, {
        object_key: presigned.object_key,
        role: photoRole,
        weight_kg: weightKg ? Number(weightKg) : null,
        user_notes: userNotes.trim() || null,
      });

      setPhotoResult(analysis);
      const refreshedProfile = await api.getProfile(token);
      setProfile(refreshedProfile);
      setStatusMsg("Photo processed");
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Photo processing failed",
      );
      setStatusMsg("Error during photo pipeline");
    } finally {
      setProcessingPhoto(false);
    }
  }

  async function handleGenerateWorkout(regenerate: boolean) {
    if (!token) return;
    setLoadingWorkout(true);
    setErrorMsg(null);
    setStatusMsg(
      regenerate ? "Regenerating workout..." : "Fetching today's workout...",
    );
    try {
      const plan = await api.generateWorkout(token, regenerate);
      setWorkout(plan);
      setStatusMsg("Workout ready");
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Workout generation failed",
      );
    } finally {
      setLoadingWorkout(false);
    }
  }

  const critique = (photoResult?.ai_analysis ?? null) as CritiquePayload | null;

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6 md:p-10">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-zinc-800 pb-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Kinetix-AI Vertical Slice
            </h1>
            <p className="text-sm text-zinc-400">
              MediaPipe Pose Normalization + PydanticAI Physique &amp; Workout
              Coach
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono bg-zinc-900 border border-zinc-800 px-3 py-2 rounded-lg">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                token ? "bg-emerald-400" : "bg-amber-400 animate-pulse"
              }`}
            />
            <span>{statusMsg}</span>
          </div>
        </header>

        {errorMsg && (
          <div className="bg-red-950/60 border border-red-800 text-red-200 text-sm p-4 rounded-lg">
            <strong>Error:</strong> {errorMsg}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Panel 1: User Profile & Constraints */}
          <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                1. Training Profile &amp; Equipment
              </h2>
              {profile && (
                <div className="flex gap-2 text-xs font-mono">
                  <span
                    className={`px-2 py-0.5 rounded ${
                      profile.baseline_photo_id
                        ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                        : "bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    Baseline: {profile.baseline_photo_id ? "Set" : "None"}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded ${
                      profile.goal_photo_id
                        ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                        : "bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    Goal: {profile.goal_photo_id ? "Set" : "None"}
                  </span>
                </div>
              )}
            </div>

            <form onSubmit={handleSaveProfile} className="space-y-4 text-sm">
              <div>
                <label className="block text-zinc-400 mb-1">Goal Summary</label>
                <input
                  type="text"
                  value={goalSummary}
                  onChange={(e) => setGoalSummary(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-zinc-400 mb-1">
                    Training Style
                  </label>
                  <select
                    value={preferredStyle}
                    onChange={(e) => setPreferredStyle(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2"
                  >
                    <option value="hypertrophy">Hypertrophy</option>
                    <option value="strength">Strength</option>
                    <option value="recomposition">Recomposition</option>
                    <option value="athletic">Athletic Conditioning</option>
                  </select>
                </div>
                <div>
                  <label className="block text-zinc-400 mb-1">
                    Days / Week
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={7}
                    value={daysPerWeek}
                    onChange={(e) => setDaysPerWeek(Number(e.target.value))}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2"
                  />
                </div>
              </div>

              <div>
                <label className="block text-zinc-400 mb-1">
                  Available Equipment (comma-separated)
                </label>
                <input
                  type="text"
                  value={equipmentInput}
                  onChange={(e) => setEquipmentInput(e.target.value)}
                  placeholder="dumbbells, pull-up bar, bench"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label className="block text-zinc-400 mb-1">
                  Injuries / Constraints
                </label>
                <input
                  type="text"
                  value={injuries}
                  onChange={(e) => setInjuries(e.target.value)}
                  placeholder="e.g. mild left shoulder impingement"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2"
                />
              </div>

              <button
                type="submit"
                disabled={!token || savingProfile}
                className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-zinc-950 font-semibold py-2.5 rounded-lg transition"
              >
                {savingProfile ? "Saving..." : "Save Profile"}
              </button>
            </form>
          </section>

          {/* Panel 2: Physique Photo Upload & Pose Pipeline */}
          <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-6 space-y-5">
            <h2 className="text-lg font-semibold">
              2. Physique Photo &amp; CV Alignment
            </h2>

            <form onSubmit={handleProcessPhoto} className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-zinc-400 mb-1">Photo Role</label>
                  <select
                    value={photoRole}
                    onChange={(e) =>
                      setPhotoRole(
                        e.target.value as "baseline" | "goal" | "progress",
                      )
                    }
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2"
                  >
                    <option value="baseline">Baseline (Starting)</option>
                    <option value="goal">Goal Reference</option>
                    <option value="progress">
                      Progress Check-In (Runs AI)
                    </option>
                  </select>
                </div>
                <div>
                  <label className="block text-zinc-400 mb-1">
                    Weight (kg, optional)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={weightKg}
                    onChange={(e) => setWeightKg(e.target.value)}
                    placeholder="78.5"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2"
                  />
                </div>
              </div>

              <div>
                <label className="block text-zinc-400 mb-1">
                  Check-in Notes (optional)
                </label>
                <input
                  type="text"
                  value={userNotes}
                  onChange={(e) => setUserNotes(e.target.value)}
                  placeholder="Fasted morning lighting, week 4"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label className="block text-zinc-400 mb-1">
                  Select Image (JPEG / PNG / WebP)
                </label>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                  className="w-full text-xs text-zinc-400 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-zinc-800 file:text-zinc-200 hover:file:bg-zinc-700"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={!token || !selectedFile || processingPhoto}
                className="w-full bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-zinc-950 font-semibold py-2.5 rounded-lg transition"
              >
                {processingPhoto
                  ? "Aligning & Analyzing..."
                  : "Upload & Process Photo"}
              </button>
            </form>

            {photoResult && (
              <div className="border-t border-zinc-800 pt-4 space-y-4">
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="bg-zinc-950 border border-zinc-800 p-2.5 rounded-lg">
                    <div className="text-zinc-400">Pose Detected</div>
                    <div className="font-mono font-semibold text-sm mt-0.5">
                      {photoResult.pose_detected ? "Yes" : "Fallback"}
                    </div>
                  </div>
                  <div className="bg-zinc-950 border border-zinc-800 p-2.5 rounded-lg">
                    <div className="text-zinc-400">Shoulder : Waist</div>
                    <div className="font-mono font-semibold text-sm mt-0.5">
                      {photoResult.shoulder_to_waist_ratio ?? "N/A"}
                    </div>
                  </div>
                  <div className="bg-zinc-950 border border-zinc-800 p-2.5 rounded-lg">
                    <div className="text-zinc-400">Waist : Hip</div>
                    <div className="font-mono font-semibold text-sm mt-0.5">
                      {photoResult.waist_to_hip_ratio ?? "N/A"}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-4 items-start">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photoResult.aligned_preview_url}
                    alt="Pose-aligned physique preview"
                    className="w-36 h-48 object-cover rounded-lg border border-zinc-700 bg-zinc-950 shrink-0"
                  />
                  {critique ? (
                    <div className="space-y-2 text-xs">
                      <div className="font-semibold text-emerald-400 text-sm">
                        Goal Alignment Score:{" "}
                        {critique.overall_trajectory_score}/100
                      </div>
                      <p className="text-zinc-300 leading-relaxed">
                        {critique.body_composition_summary}
                      </p>
                      {critique.recommended_training_focus && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {critique.recommended_training_focus.map((area) => (
                            <span
                              key={area}
                              className="bg-emerald-950/80 border border-emerald-800 text-emerald-300 px-2 py-0.5 rounded"
                            >
                              {area}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-400">
                      Reference photo stored and pose-normalized. Upload a{" "}
                      <strong>Progress Check-In</strong> photo next to run full
                      VLM comparison.
                    </p>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>

        {/* Panel 3: Daily Adaptive Workout */}
        <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">
                3. Adaptive Daily Workout Plan
              </h2>
              <p className="text-xs text-zinc-400">
                Synthesized from your equipment, constraints, and latest
                physique priorities
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!token || loadingWorkout}
                onClick={() => handleGenerateWorkout(false)}
                className="bg-zinc-100 hover:bg-white disabled:opacity-50 text-zinc-950 text-sm font-semibold px-4 py-2 rounded-lg transition"
              >
                {loadingWorkout ? "Generating..." : "Load / Generate Today"}
              </button>
              <button
                type="button"
                disabled={!token || loadingWorkout}
                onClick={() => handleGenerateWorkout(true)}
                className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200 text-sm px-3 py-2 rounded-lg transition"
              >
                Regenerate
              </button>
            </div>
          </div>

          {workout && (
            <div className="space-y-4">
              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4">
                <div className="text-xs font-mono text-emerald-400 uppercase">
                  {workout.plan_date} &bull; {workout.focus_area}
                </div>
                <p className="text-sm text-zinc-300 mt-1">
                  {workout.rationale}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {workout.tasks.map((task, idx) => (
                  <div
                    key={`${task.exercise_name}-${idx}`}
                    className="bg-zinc-950/90 border border-zinc-800 rounded-lg p-4 space-y-1.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-sm text-zinc-100">
                        {idx + 1}. {task.exercise_name}
                      </h3>
                      <span className="text-xs font-mono bg-zinc-900 border border-zinc-700 px-2 py-0.5 rounded shrink-0">
                        {task.sets} &times; {task.rep_range}
                      </span>
                    </div>
                    <div className="text-xs text-zinc-400">
                      Target:{" "}
                      <span className="text-zinc-300">
                        {task.target_muscle}
                      </span>{" "}
                      &bull; Equipment:{" "}
                      <span className="text-zinc-300">
                        {task.equipment_used}
                      </span>{" "}
                      &bull; Rest:{" "}
                      <span className="text-zinc-300">
                        {task.rest_seconds}s
                      </span>
                    </div>
                    <p className="text-xs text-emerald-300/90 pt-1">
                      Cue: {task.execution_cue}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
