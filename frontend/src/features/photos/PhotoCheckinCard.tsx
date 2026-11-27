"use client";

import { useState } from "react";
import { api, PhotoAnalysis } from "@/lib/api";

interface CritiquePayload {
  overall_trajectory_score?: number;
  body_composition_summary?: string;
  recommended_training_focus?: string[];
}

interface PhotoCheckinCardProps {
  token: string | null;
  onStatusChange: (msg: string) => void;
  onError: (msg: string | null) => void;
  onPhotoProcessed: () => Promise<void> | void;
}

export function PhotoCheckinCard({
  token,
  onStatusChange,
  onError,
  onPhotoProcessed,
}: PhotoCheckinCardProps) {
  const [photoRole, setPhotoRole] = useState<"baseline" | "goal" | "progress">(
    "baseline",
  );
  const [weightKg, setWeightKg] = useState("");
  const [userNotes, setUserNotes] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [processingPhoto, setProcessingPhoto] = useState(false);
  const [photoResult, setPhotoResult] = useState<PhotoAnalysis | null>(null);

  async function handleProcessPhoto(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !selectedFile) return;

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
      const analysis = await api.processPhoto(token, {
        object_key: presigned.object_key,
        role: photoRole,
        weight_kg: weightKg ? Number(weightKg) : null,
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

  const critique = (photoResult?.ai_analysis ?? null) as CritiquePayload | null;

  return (
    <section className="bg-zinc-900/70 border border-zinc-800 rounded-2xl p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base sm:text-lg font-semibold">
          Check-In Photo &amp; Pose
        </h2>
        <span className="text-[11px] font-mono text-zinc-400">
          MediaPipe + R2
        </span>
      </div>

      <form onSubmit={handleProcessPhoto} className="space-y-3.5 text-sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              Photo Type
            </label>
            <select
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
            <label className="block text-xs text-zinc-400 mb-1">
              Weight (kg)
            </label>
            <input
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
          <label className="block text-xs text-zinc-400 mb-1">
            Notes (optional)
          </label>
          <input
            type="text"
            value={userNotes}
            onChange={(e) => setUserNotes(e.target.value)}
            placeholder="Morning check-in, lighting notes"
            className="w-full min-h-11 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-base sm:text-sm"
          />
        </div>

        <div>
          <label className="block text-xs text-zinc-400 mb-1">
            Choose Photo
          </label>
          <input
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
            {critique ? (
              <div className="space-y-2 text-xs sm:text-sm w-full">
                <div className="font-semibold text-emerald-400">
                  Goal Alignment Score: {critique.overall_trajectory_score}/100
                </div>
                <p className="text-zinc-300 leading-relaxed">
                  {critique.body_composition_summary}
                </p>
                {critique.recommended_training_focus && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {critique.recommended_training_focus.map((area) => (
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
