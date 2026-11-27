"use client";

import { useCallback, useEffect, useState } from "react";
import { api, fetchDevToken, UserProfile } from "@/lib/api";
import { PhotoCheckinCard } from "@/features/photos/PhotoCheckinCard";
import { ProfileCard } from "@/features/profile/ProfileCard";
import { WorkoutBoard } from "@/features/workouts/WorkoutBoard";

export default function KinetixDashboard() {
  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [statusMsg, setStatusMsg] = useState("Connecting...");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const refreshProfile = useCallback(async (authToken: string) => {
    const prof = await api.getProfile(authToken);
    setProfile(prof);
  }, []);

  useEffect(() => {
    let active = true;
    async function init() {
      try {
        const jwt = await fetchDevToken();
        if (!active) return;
        setToken(jwt);
        setStatusMsg("Connected");

        const prof = await api.getProfile(jwt);
        if (!active) return;
        setProfile(prof);
      } catch (err) {
        if (!active) return;
        setErrorMsg(
          err instanceof Error ? err.message : "Failed to initialize session",
        );
        setStatusMsg("Offline");
      }
    }
    init();
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="min-h-dvh bg-zinc-950 text-zinc-100 px-4 py-5 sm:px-6 md:px-10 md:py-8">
      <div className="max-w-6xl mx-auto space-y-5 md:space-y-8">
        <header className="flex flex-col gap-3 border-b border-zinc-800 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
                Kinetix-AI
              </h1>
              <p className="text-xs sm:text-sm text-zinc-400">
                Pose-normalized progress &amp; adaptive daily training
              </p>
            </div>
            <div className="sm:hidden flex items-center gap-1.5 text-[11px] font-mono bg-zinc-900 border border-zinc-800 px-2.5 py-1.5 rounded-full shrink-0">
              <span
                className={`h-2 w-2 rounded-full ${
                  token ? "bg-emerald-400" : "bg-amber-400 animate-pulse"
                }`}
              />
              <span>{statusMsg}</span>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-2 text-xs font-mono bg-zinc-900 border border-zinc-800 px-3 py-2 rounded-lg shrink-0">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                token ? "bg-emerald-400" : "bg-amber-400 animate-pulse"
              }`}
            />
            <span>{statusMsg}</span>
          </div>
        </header>

        {errorMsg && (
          <div
            role="alert"
            className="bg-red-950/70 border border-red-800 text-red-200 text-sm p-3.5 rounded-xl"
          >
            <span className="font-semibold">Error: </span>
            {errorMsg}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 md:gap-8">
          <PhotoCheckinCard
            token={token}
            onStatusChange={setStatusMsg}
            onError={setErrorMsg}
            onPhotoProcessed={() => (token ? refreshProfile(token) : undefined)}
          />
          <ProfileCard
            token={token}
            profile={profile}
            onProfileSaved={setProfile}
            onStatusChange={setStatusMsg}
            onError={setErrorMsg}
          />
        </div>

        <WorkoutBoard
          token={token}
          onStatusChange={setStatusMsg}
          onError={setErrorMsg}
        />
      </div>
    </main>
  );
}
