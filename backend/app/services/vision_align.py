from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Optional
import io
from PIL import Image, ImageOps

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision
from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class AlignmentResult:
    aligned_image_bytes: bytes
    pose_detected: bool
    shoulder_to_waist_ratio: Optional[float] = None
    waist_to_hip_ratio: Optional[float] = None
    landmarks_summary: dict[str, Any] = field(default_factory=dict)


def _default_model_path() -> Path:
    # backend/app/services/vision_align.py -> parents[2] is backend/
    backend_root = Path(__file__).resolve().parents[2]
    candidate = backend_root / "models" / "pose_landmarker_full.task"
    if candidate.exists():
        return candidate
    cwd_candidate = Path("models/pose_landmarker_full.task")
    return cwd_candidate


class PhysiqueVisionNormalizer:
    """Normalizes pose orientation/framing and estimates torso proportions using MediaPipe Tasks PoseLandmarker."""

    def __init__(self, model_path: str | Path | None = None) -> None:
        resolved_path = (
            Path(model_path) if model_path is not None else _default_model_path()
        )
        if not resolved_path.exists():
            raise FileNotFoundError(
                f"PoseLandmarker model not found at '{resolved_path}'. "
                "Download pose_landmarker_full.task into backend/models/."
            )

        base_options = mp_python.BaseOptions(model_asset_path=str(resolved_path))
        options = mp_vision.PoseLandmarkerOptions(
            base_options=base_options,
            running_mode=mp_vision.RunningMode.IMAGE,
            num_poses=1,
            min_pose_detection_confidence=0.5,
            min_pose_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self._landmarker = mp_vision.PoseLandmarker.create_from_options(options)

    def close(self) -> None:
        if getattr(self, "_landmarker", None) is not None:
            self._landmarker.close()
            self._landmarker = None

    def __del__(self) -> None:
        self.close()

    def normalize_and_measure(self, image_bytes: bytes) -> AlignmentResult:
        np_buf = np.frombuffer(image_bytes, dtype=np.uint8)
        bgr = cv2.imdecode(np_buf, cv2.IMREAD_COLOR)
        if bgr is None:
            raise ValueError("Unable to decode image bytes for pose normalization.")

        h, w, _ = bgr.shape
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        detection = self._landmarker.detect(mp_image)

        if not detection.pose_landmarks or len(detection.pose_landmarks) == 0:
            encoded = self._encode_webp(bgr)
            return AlignmentResult(
                aligned_image_bytes=encoded,
                pose_detected=False,
                shoulder_to_waist_ratio=None,
                waist_to_hip_ratio=None,
                landmarks_summary={
                    "detected": False,
                    "landmark_count": 0,
                    "keypoints": {},
                },
            )

        landmarks = detection.pose_landmarks[0]
        # MediaPipe Pose indices: 11 = left shoulder, 12 = right shoulder, 23 = left hip, 24 = right hip
        l_sh = landmarks[11]
        r_sh = landmarks[12]
        l_hip = landmarks[23]
        r_hip = landmarks[24]

        shoulder_width_px = math.hypot((r_sh.x - l_sh.x) * w, (r_sh.y - l_sh.y) * h)
        hip_width_px = math.hypot((r_hip.x - l_hip.x) * w, (r_hip.y - l_hip.y) * h)

        # Midpoint angle between shoulders to level horizontal roll
        dy = (r_sh.y - l_sh.y) * h
        dx = (r_sh.x - l_sh.x) * w
        tilt_deg = math.degrees(math.atan2(dy, dx)) if abs(dx) > 1e-6 else 0.0

        center_x = ((l_sh.x + r_sh.x + l_hip.x + r_hip.x) / 4.0) * w
        center_y = ((l_sh.y + r_sh.y + l_hip.y + r_hip.y) / 4.0) * h

        rot_matrix = cv2.getRotationMatrix2D((center_x, center_y), tilt_deg, 1.0)
        aligned = cv2.warpAffine(
            bgr,
            rot_matrix,
            (w, h),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REPLICATE,
        )

        # Approximate waist width near ~62% down from shoulder midpoint toward hip midpoint
        sh_mid_x = ((l_sh.x + r_sh.x) / 2.0) * w
        sh_mid_y = ((l_sh.y + r_sh.y) / 2.0) * h
        hip_mid_x = ((l_hip.x + r_hip.x) / 2.0) * w
        hip_mid_y = ((l_hip.y + r_hip.y) / 2.0) * h

        waist_y = int(round(sh_mid_y + 0.62 * (hip_mid_y - sh_mid_y)))
        waist_center_x = int(round(sh_mid_x + 0.62 * (hip_mid_x - sh_mid_x)))
        waist_width_px = self._estimate_horizontal_span_px(
            aligned,
            y_px=waist_y,
            center_x_px=waist_center_x,
            max_half_width_px=max(int(max(shoulder_width_px, hip_width_px) * 0.75), 30),
        )

        s_to_w = (
            round(shoulder_width_px / waist_width_px, 3)
            if waist_width_px and waist_width_px > 1.0
            else None
        )
        w_to_h = (
            round(waist_width_px / hip_width_px, 3)
            if waist_width_px and hip_width_px > 1.0
            else None
        )

        keypoints = {
            "left_shoulder": {
                "x": round(l_sh.x, 4),
                "y": round(l_sh.y, 4),
                "visibility": round(getattr(l_sh, "visibility", 0.0) or 0.0, 3),
            },
            "right_shoulder": {
                "x": round(r_sh.x, 4),
                "y": round(r_sh.y, 4),
                "visibility": round(getattr(r_sh, "visibility", 0.0) or 0.0, 3),
            },
            "left_hip": {
                "x": round(l_hip.x, 4),
                "y": round(l_hip.y, 4),
                "visibility": round(getattr(l_hip, "visibility", 0.0) or 0.0, 3),
            },
            "right_hip": {
                "x": round(r_hip.x, 4),
                "y": round(r_hip.y, 4),
                "visibility": round(getattr(r_hip, "visibility", 0.0) or 0.0, 3),
            },
        }
        landmarks_summary = {
            "detected": True,
            "landmark_count": len(landmarks),
            "tilt_deg": round(tilt_deg, 2),
            "keypoints": keypoints,
        }

        encoded = self._encode_webp(aligned)

        try:
            pil_img = Image.open(io.BytesIO(image_bytes))
            pil_img = ImageOps.exif_transpose(pil_img).convert("RGB")
            rgb = np.array(pil_img)
            bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        except Exception as exc:
            raise ValueError(
                "Unable to decode image bytes for pose normalization."
            ) from exc

        return AlignmentResult(
            aligned_image_bytes=encoded,
            pose_detected=True,
            shoulder_to_waist_ratio=s_to_w,
            waist_to_hip_ratio=w_to_h,
            landmarks_summary=landmarks_summary,
        )

    @staticmethod
    def _estimate_horizontal_span_px(
        bgr_image: np.ndarray,
        y_px: int,
        center_x_px: int,
        max_half_width_px: int,
    ) -> Optional[float]:
        h, w, _ = bgr_image.shape
        if y_px < 0 or y_px >= h:
            return None

        gray = cv2.cvtColor(bgr_image, cv2.COLOR_BGR2GRAY)
        row = gray[y_px, :].astype(np.float32)
        grad = np.abs(np.gradient(row))

        left_bound = max(0, center_x_px - max_half_width_px)
        right_bound = min(w, center_x_px + max_half_width_px + 1)
        if right_bound - left_bound < 10:
            return None

        left_slice = grad[left_bound:center_x_px]
        right_slice = grad[center_x_px:right_bound]
        if left_slice.size == 0 or right_slice.size == 0:
            return None

        left_peak_idx = left_bound + int(np.argmax(left_slice))
        right_peak_idx = center_x_px + int(np.argmax(right_slice))
        span = float(right_peak_idx - left_peak_idx)
        return span if span > 5.0 else None

    @staticmethod
    def _encode_webp(bgr_image: np.ndarray, quality: int = 88) -> bytes:
        ok, buf = cv2.imencode(
            ".webp", bgr_image, [int(cv2.IMWRITE_WEBP_QUALITY), quality]
        )
        if not ok:
            raise RuntimeError("Failed to encode normalized image to WebP.")
        return buf.tobytes()
