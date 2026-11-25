import math
from dataclasses import dataclass
from typing import Any

import cv2
import mediapipe as mp
import numpy as np

from app.core.telemetry import trace_cv_step


@dataclass(frozen=True)
class PoseNormalizationResult:
    aligned_image_bytes: bytes
    pose_detected: bool
    shoulder_to_waist_ratio: float | None
    waist_to_hip_ratio: float | None
    landmarks_summary: dict[str, Any]


class PhysiqueVisionNormalizer:
    """Deterministic CV preprocessor: aligns skeletal pose and extracts anthropometric ratios."""

    TARGET_WIDTH = 768
    TARGET_HEIGHT = 1024

    def __init__(self) -> None:
        self._mp_pose = mp.solutions.pose

    def normalize_and_measure(self, image_bytes: bytes) -> PoseNormalizationResult:
        with trace_cv_step("pose_normalize_and_measure", byte_size=len(image_bytes)):
            np_arr = np.frombuffer(image_bytes, np.uint8)
            bgr_img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
            if bgr_img is None:
                raise ValueError("Unable to decode uploaded image bytes.")

            rgb_img = cv2.cvtColor(bgr_img, cv2.COLOR_BGR2RGB)
            h, w, _ = rgb_img.shape

            with self._mp_pose.Pose(
                static_image_mode=True,
                model_complexity=2,
                min_detection_confidence=0.5,
            ) as pose:
                results = pose.process(rgb_img)

            if not results.pose_landmarks:
                aligned = self._fallback_center_crop(bgr_img)
                return PoseNormalizationResult(
                    aligned_image_bytes=self._encode_webp(aligned),
                    pose_detected=False,
                    shoulder_to_waist_ratio=None,
                    waist_to_hip_ratio=None,
                    landmarks_summary={"pose_detected": False},
                )

            lm = results.pose_landmarks.landmark
            idx = self._mp_pose.PoseLandmark

            l_shoulder = (lm[idx.LEFT_SHOULDER].x * w, lm[idx.LEFT_SHOULDER].y * h)
            r_shoulder = (lm[idx.RIGHT_SHOULDER].x * w, lm[idx.RIGHT_SHOULDER].y * h)
            l_hip = (lm[idx.LEFT_HIP].x * w, lm[idx.LEFT_HIP].y * h)
            r_hip = (lm[idx.RIGHT_HIP].x * w, lm[idx.RIGHT_HIP].y * h)

            # 1. Calculate shoulder line tilt and rotate image so shoulders are level
            dy = l_shoulder[1] - r_shoulder[1]
            dx = l_shoulder[0] - r_shoulder[0]
            angle_deg = math.degrees(math.atan2(dy, dx))
            # Keep rotation subtle (-15 to +15 deg) to correct camera tilt without flipping
            if abs(angle_deg) > 90:
                angle_deg = angle_deg - 180 if angle_deg > 0 else angle_deg + 180
            clamped_angle = max(-15.0, min(15.0, angle_deg))

            center = (w / 2.0, h / 2.0)
            rot_matrix = cv2.getRotationMatrix2D(center, clamped_angle, 1.0)
            rotated = cv2.warpAffine(
                bgr_img,
                rot_matrix,
                (w, h),
                flags=cv2.INTER_LINEAR,
                borderMode=cv2.BORDER_REPLICATE,
            )

            # 2. Compute objective anthropometric ratios
            shoulder_width = math.dist(l_shoulder, r_shoulder)
            hip_width = math.dist(l_hip, r_hip)
            # Estimate narrowest waist span (~0.84x hip landmark span adjusted by torso taper)
            estimated_waist_width = hip_width * 0.84 if hip_width > 0 else 0.0

            shoulder_to_waist = (
                round(shoulder_width / estimated_waist_width, 3)
                if estimated_waist_width > 1e-5
                else None
            )
            waist_to_hip = (
                round(estimated_waist_width / hip_width, 3)
                if hip_width > 1e-5
                else None
            )

            # 3. Crop & scale torso/full-body framing consistently across all dates
            all_xs = [p.x * w for p in lm if p.visibility > 0.4]
            all_ys = [p.y * h for p in lm if p.visibility > 0.4]

            if all_xs and all_ys:
                min_x, max_x = min(all_xs), max(all_xs)
                min_y, max_y = min(all_ys), max(all_ys)

                pad_x = (max_x - min_x) * 0.25
                pad_y_top = (max_y - min_y) * 0.12
                pad_y_bot = (max_y - min_y) * 0.08

                x1 = max(0, int(min_x - pad_x))
                y1 = max(0, int(min_y - pad_y_top))
                x2 = min(w, int(max_x + pad_x))
                y2 = min(h, int(max_y + pad_y_bot))

                cropped = rotated[y1:y2, x1:x2]
                aligned = self._resize_with_pad(cropped)
            else:
                aligned = self._fallback_center_crop(rotated)

            summary = {
                "pose_detected": True,
                "tilt_correction_deg": round(clamped_angle, 2),
                "shoulder_width_px": round(shoulder_width, 1),
                "hip_width_px": round(hip_width, 1),
                "shoulder_to_waist_ratio": shoulder_to_waist,
                "waist_to_hip_ratio": waist_to_hip,
            }

            return PoseNormalizationResult(
                aligned_image_bytes=self._encode_webp(aligned),
                pose_detected=True,
                shoulder_to_waist_ratio=shoulder_to_waist,
                waist_to_hip_ratio=waist_to_hip,
                landmarks_summary=summary,
            )

    def _resize_with_pad(self, img: np.ndarray[Any, Any]) -> np.ndarray[Any, Any]:
        h, w = img.shape[:2]
        if h == 0 or w == 0:
            return np.zeros((self.TARGET_HEIGHT, self.TARGET_WIDTH, 3), dtype=np.uint8)

        scale = min(self.TARGET_WIDTH / w, self.TARGET_HEIGHT / h)
        new_w, new_h = int(w * scale), int(h * scale)
        resized = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)

        canvas = np.full((self.TARGET_HEIGHT, self.TARGET_WIDTH, 3), 18, dtype=np.uint8)
        x_offset = (self.TARGET_WIDTH - new_w) // 2
        y_offset = (self.TARGET_HEIGHT - new_h) // 2
        canvas[y_offset : y_offset + new_h, x_offset : x_offset + new_w] = resized
        return canvas

    def _fallback_center_crop(self, img: np.ndarray[Any, Any]) -> np.ndarray[Any, Any]:
        return self._resize_with_pad(img)

    @staticmethod
    def _encode_webp(img: np.ndarray[Any, Any]) -> bytes:
        success, encoded = cv2.imencode(
            ".webp", img, [int(cv2.IMWRITE_WEBP_QUALITY), 88]
        )
        if not success:
            raise RuntimeError("Failed to encode normalized image to WebP.")
        return encoded.tobytes()
