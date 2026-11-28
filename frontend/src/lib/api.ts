export interface UserProfile {
  goal_summary: string;
  preferred_style: string;
  available_equipment: string[];
  injuries_or_constraints: string | null;
  days_per_week: number;
  baseline_photo_id?: string | null;
  goal_photo_id?: string | null;
}

export interface PhotoPresignResponse {
  upload_url: string;
  object_key: string;
}

export interface PhotoAnalysis {
  id?: string;
  object_key?: string;
  role?: "baseline" | "goal" | "progress";
  pose_detected: boolean;
  shoulder_to_waist_ratio: number | null;
  waist_to_hip_ratio: number | null;
  aligned_preview_url: string;
  ai_analysis: Record<string, unknown> | null;
}

export interface WorkoutTask {
  exercise_name: string;
  target_muscle: string;
  equipment_used: string;
  sets: number;
  rep_range: string;
  rest_seconds: number;
  execution_cue: string;
  completed?: boolean;
}

export interface DailyWorkout {
  plan_id?: string;
  id?: string;
  plan_date: string;
  focus_area: string;
  rationale: string;
  tasks: WorkoutTask[];
  completed?: boolean;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function parseJsonOrThrow<T>(
  res: Response,
  fallbackMessage: string,
): Promise<T> {
  if (!res.ok) {
    let detail = "";
    try {
      const errBody = await res.json();
      detail = typeof errBody?.detail === "string" ? `: ${errBody.detail}` : "";
    } catch {
      // Ignore non-JSON error responses
    }
    throw new Error(`${fallbackMessage} (${res.status})${detail}`);
  }
  return (await res.json()) as T;
}

export async function fetchDevToken(): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/dev/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  const data = await parseJsonOrThrow<{
    access_token?: string;
    token?: string;
  }>(res, "Failed to fetch dev token");
  const token = data.access_token ?? data.token;
  if (!token) {
    throw new Error("Auth token missing from /dev/token response");
  }
  return token;
}

export const api = {
  async getProfile(token: string): Promise<UserProfile> {
    const res = await fetch(`${API_BASE_URL}/api/v1/profile`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    return parseJsonOrThrow<UserProfile>(res, "Failed to load profile");
  },

  async saveProfile(token: string, payload: UserProfile): Promise<UserProfile> {
    const res = await fetch(`${API_BASE_URL}/api/v1/profile`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    return parseJsonOrThrow<UserProfile>(res, "Failed to save profile");
  },

  async presignPhoto(
    token: string,
    contentType: string,
  ): Promise<PhotoPresignResponse> {
    const res = await fetch(`${API_BASE_URL}/api/v1/photos/presign`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ content_type: contentType }),
    });
    return parseJsonOrThrow<PhotoPresignResponse>(
      res,
      "Failed to create upload URL",
    );
  },

  async processPhoto(
    token: string,
    payload: {
      object_key: string;
      role: "baseline" | "goal" | "progress";
      weight_kg: number | null;
      user_notes: string | null;
    },
  ): Promise<PhotoAnalysis> {
    const res = await fetch(`${API_BASE_URL}/api/v1/photos/process`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    return parseJsonOrThrow<PhotoAnalysis>(res, "Failed to process photo");
  },

  async generateWorkout(
    token: string,
    regenerate: boolean,
    sessionRequest?: string | null,
  ): Promise<DailyWorkout> {
    const trimmedRequest = sessionRequest?.trim() || null;
    const res = await fetch(`${API_BASE_URL}/api/v1/workouts/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        regenerate,
        session_request: trimmedRequest,
      }),
    });
    return parseJsonOrThrow<DailyWorkout>(res, "Failed to load workout");
  },

  async patchWorkoutTask(
    token: string,
    workoutId: string,
    taskIndex: number,
    completed: boolean,
  ): Promise<DailyWorkout> {
    const res = await fetch(
      `${API_BASE_URL}/api/v1/workouts/${workoutId}/tasks/${taskIndex}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ completed }),
      },
    );
    return parseJsonOrThrow<DailyWorkout>(res, "Failed to update workout task");
  },
};
