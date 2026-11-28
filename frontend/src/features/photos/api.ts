import {
  api,
  type DailyWorkout,
  type PhotoAnalysis,
  type WorkoutTask,
} from "@/lib/api";

export type { DailyWorkout, PhotoAnalysis, WorkoutTask };

export type CoachingVerdict =
  | "stay_the_course"
  | "tighten_nutrition"
  | "increase_fuel"
  | "pivot_volume"
  | "deload_recover";

export interface WorkoutAdjustment {
  priority_muscle_groups: string[];
  volume_and_density_directive: string;
  next_session_focus_prompt: string;
}

export interface DietAdjustment {
  caloric_stance: string;
  protein_and_macro_priority: string;
  immediate_weekly_habit: string;
}

export interface PhysiqueAssessment {
  current_shape_summary: string;
  delta_since_last_checkin: string;
  gap_to_goal: string;
  verdict: CoachingVerdict;
  workout_adjustment: WorkoutAdjustment;
  diet_adjustment: DietAdjustment;
}

export interface PhotoCheckIn {
  id: string;
  user_id: string;
  pose_label: string;
  notes: string | null;
  preview_url: string;
  days_since_previous: number | null;
  created_at: string;
  assessment: PhysiqueAssessment;
}

export interface PhotoHistoryResponse {
  total: number;
  checkins: PhotoCheckIn[];
}

export type SortDirection = "asc" | "desc";

const RAW_API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const API_BASE = RAW_API_BASE.replace(/\/+$/, "");

const READ_TIMEOUT_MS = 15_000;
const AI_TIMEOUT_MS = 60_000;

export class ApiRequestError extends Error {
  public readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

function buildAuthHeaders(token: string): Record<string, string> {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error("Missing authentication token.");
  }
  return {
    Authorization: `Bearer ${trimmed}`,
  };
}

async function parseErrorMessage(
  res: Response,
  fallback: string,
): Promise<string> {
  const contentType = res.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const payload = (await res.json()) as {
        detail?: unknown;
        message?: unknown;
      };
      if (typeof payload.detail === "string" && payload.detail.trim()) {
        return payload.detail.trim();
      }
      if (typeof payload.message === "string" && payload.message.trim()) {
        return payload.message.trim();
      }
    }
    const text = (await res.text()).trim();
    return text || fallback;
  } catch {
    return fallback;
  }
}

export async function fetchPhotoHistory(
  token: string,
  order: SortDirection = "asc",
  limit = 50,
): Promise<PhotoHistoryResponse> {
  const headers = buildAuthHeaders(token);
  const url = `${API_BASE}/api/v1/photos?order=${encodeURIComponent(order)}&limit=${encodeURIComponent(String(limit))}`;

  const res = await fetch(url, {
    method: "GET",
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(READ_TIMEOUT_MS),
  });

  if (!res.ok) {
    const message = await parseErrorMessage(
      res,
      `Failed to fetch photo history (HTTP ${res.status}).`,
    );
    throw new ApiRequestError(message, res.status);
  }

  return (await res.json()) as PhotoHistoryResponse;
}

export interface UploadPhotoCheckInInput {
  file: File;
  poseLabel: string;
  notes?: string;
}

export async function uploadPhotoCheckIn(
  token: string,
  input: UploadPhotoCheckInInput,
): Promise<PhotoCheckIn> {
  const headers = buildAuthHeaders(token);
  const formData = new FormData();
  formData.append("file", input.file);
  formData.append("pose_label", input.poseLabel.trim() || "checkin");

  const cleanNotes = input.notes?.trim();
  if (cleanNotes) {
    formData.append("notes", cleanNotes);
  }

  const res = await fetch(`${API_BASE}/api/v1/photos/checkin`, {
    method: "POST",
    headers,
    body: formData,
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
  });

  if (!res.ok) {
    const message = await parseErrorMessage(
      res,
      `Failed to upload physique check-in (HTTP ${res.status}).`,
    );
    throw new ApiRequestError(message, res.status);
  }

  return (await res.json()) as PhotoCheckIn;
}

export async function generateWorkoutFromFocus(
  token: string,
  sessionRequest: string,
): Promise<DailyWorkout> {
  const trimmedRequest = sessionRequest.trim();
  if (!trimmedRequest) {
    throw new Error("Workout focus prompt cannot be empty.");
  }
  return api.generateWorkout(token, true, trimmedRequest);
}
