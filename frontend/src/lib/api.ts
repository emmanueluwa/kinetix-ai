const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export interface UserProfile {
  user_id: string;
  goal_summary: string;
  preferred_style: string;
  available_equipment: string[];
  injuries_or_constraints: string | null;
  days_per_week: number;
  baseline_photo_id: string | null;
  goal_photo_id: string | null;
}

export interface PhotoAnalysis {
  photo_id: string;
  role: "baseline" | "goal" | "progress";
  aligned_preview_url: string;
  pose_detected: boolean;
  shoulder_to_waist_ratio: number | null;
  waist_to_hip_ratio: number | null;
  ai_analysis: Record<string, unknown> | null;
}

export interface DailyWorkout {
  plan_id: string;
  plan_date: string;
  focus_area: string;
  rationale: string;
  tasks: Array<{
    exercise_name: string;
    target_muscle: string;
    sets: number;
    rep_range: string;
    rest_seconds: number;
    equipment_used: string;
    execution_cue: string;
  }>;
  completed: boolean;
}

export async function fetchDevToken(): Promise<string> {
  const res = await fetch(`${API_BASE}/dev/token`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to fetch dev token: ${res.status}`);
  const data: { access_token: string } = await res.json();
  return data.access_token;
}

async function authedFetch<T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getProfile: (token: string) =>
    authedFetch<UserProfile>("/api/v1/profile", token),
  saveProfile: (token: string, payload: Partial<UserProfile>) =>
    authedFetch<UserProfile>("/api/v1/profile", token, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  presignPhoto: (token: string, contentType: string) =>
    authedFetch<{ object_key: string; upload_url: string; expires_in: number }>(
      "/api/v1/photos/presign",
      token,
      { method: "POST", body: JSON.stringify({ content_type: contentType }) },
    ),
  processPhoto: (
    token: string,
    payload: {
      object_key: string;
      role: "baseline" | "goal" | "progress";
      weight_kg?: number | null;
      user_notes?: string | null;
    },
  ) =>
    authedFetch<PhotoAnalysis>("/api/v1/photos/process", token, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  generateWorkout: (token: string, regenerate = false) =>
    authedFetch<DailyWorkout>(
      `/api/v1/workouts/today?regenerate=${regenerate}`,
      token,
      {
        method: "POST",
      },
    ),
};
