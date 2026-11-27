"use client";

import { useEffect, useState } from "react";
import { api, UserProfile } from "@/lib/api";

interface ProfileCardProps {
  token: string | null;
  profile: UserProfile | null;
  onProfileSaved: (updated: UserProfile) => void;
  onStatusChange: (msg: string) => void;
  onError: (msg: string | null) => void;
}

export function ProfileCard({
  token,
  profile,
  onProfileSaved,
  onStatusChange,
  onError,
}: ProfileCardProps) {
  const [goalSummary, setGoalSummary] = useState("");
  const [preferredStyle, setPreferredStyle] = useState("hypertrophy");
  const [equipmentInput, setEquipmentInput] = useState("");
  const [injuries, setInjuries] = useState("");
  const [daysPerWeek, setDaysPerWeek] = useState(4);
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setGoalSummary(profile.goal_summary);
    setPreferredStyle(profile.preferred_style);
    setEquipmentInput(profile.available_equipment.join(", "));
    setInjuries(profile.injuries_or_constraints ?? "");
    setDaysPerWeek(profile.days_per_week);
  }, [profile]);

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;

    setSavingProfile(true);
    onError(null);
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
      onProfileSaved(updated);
      onStatusChange("Profile saved");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSavingProfile(false);
    }
  }

  return (
    <section className="bg-zinc-900/70 border border-zinc-800 rounded-2xl p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base sm:text-lg font-semibold">
          Profile &amp; Equipment
        </h2>
        {profile && (
          <div className="flex gap-1.5 text-[11px] font-mono">
            <span
              className={`px-2 py-0.5 rounded-md ${
                profile.baseline_photo_id
                  ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                  : "bg-zinc-800 text-zinc-400"
              }`}
            >
              Base: {profile.baseline_photo_id ? "Yes" : "No"}
            </span>
            <span
              className={`px-2 py-0.5 rounded-md ${
                profile.goal_photo_id
                  ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                  : "bg-zinc-800 text-zinc-400"
              }`}
            >
              Goal: {profile.goal_photo_id ? "Yes" : "No"}
            </span>
          </div>
        )}
      </div>

      <form onSubmit={handleSaveProfile} className="space-y-3.5 text-sm">
        <div>
          <label className="block text-xs text-zinc-400 mb-1">
            Goal Summary
          </label>
          <input
            type="text"
            value={goalSummary}
            onChange={(e) => setGoalSummary(e.target.value)}
            className="w-full min-h-11 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-base sm:text-sm"
            required
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              Training Style
            </label>
            <select
              value={preferredStyle}
              onChange={(e) => setPreferredStyle(e.target.value)}
              className="w-full min-h-11 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-base sm:text-sm"
            >
              <option value="hypertrophy">Hypertrophy</option>
              <option value="strength">Strength</option>
              <option value="recomposition">Recomposition</option>
              <option value="athletic">Athletic Conditioning</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              Days / Week
            </label>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={7}
              value={daysPerWeek}
              onChange={(e) => setDaysPerWeek(Number(e.target.value))}
              className="w-full min-h-11 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-base sm:text-sm"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-zinc-400 mb-1">
            Equipment (comma-separated)
          </label>
          <input
            type="text"
            value={equipmentInput}
            onChange={(e) => setEquipmentInput(e.target.value)}
            placeholder="dumbbells, pull-up bar, bench"
            className="w-full min-h-11 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-base sm:text-sm"
          />
        </div>

        <div>
          <label className="block text-xs text-zinc-400 mb-1">
            Injuries / Limits
          </label>
          <input
            type="text"
            value={injuries}
            onChange={(e) => setInjuries(e.target.value)}
            placeholder="e.g. mild left shoulder stiffness"
            className="w-full min-h-11 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-base sm:text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={!token || savingProfile}
          className="w-full min-h-12 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-zinc-950 font-semibold px-4 py-2.5 rounded-xl transition cursor-pointer"
        >
          {savingProfile ? "Saving..." : "Save Profile"}
        </button>
      </form>
    </section>
  );
}
