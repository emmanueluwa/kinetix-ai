import io
import uuid
from dataclasses import dataclass

import boto3
from botocore.config import Config as BotoConfig
from PIL import Image, ImageOps

from app.core.config import Settings


@dataclass(frozen=True)
class PresignedUploadResult:
    object_key: str
    upload_url: str
    expires_in: int


class ObjectStorageService:
    """S3 / Cloudflare R2 client for private physique photos and EXIF sanitization."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.bucket = settings.s3_bucket_name
        self.client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint_url,
            aws_access_key_id=settings.s3_access_key_id.get_secret_value(),
            aws_secret_access_key=settings.s3_secret_access_key.get_secret_value(),
            region_name=settings.s3_region,
            config=BotoConfig(signature_version="s3v4", retries={"max_attempts": 3}),
        )

    def create_presigned_upload(
        self,
        user_id: uuid.UUID,
        category: str = "raw",
        content_type: str = "image/jpeg",
    ) -> PresignedUploadResult:
        """Issue a short-lived presigned PUT URL scoped strictly to the tenant's prefix."""
        ext = "webp" if content_type == "image/webp" else "jpg"
        object_key = f"users/{user_id}/{category}/{uuid.uuid4()}.{ext}"

        upload_url: str = self.client.generate_presigned_url(
            ClientMethod="put_object",
            Params={
                "Bucket": self.bucket,
                "Key": object_key,
                "ContentType": content_type,
            },
            ExpiresIn=self.settings.presigned_url_expiry_seconds,
        )
        return PresignedUploadResult(
            object_key=object_key,
            upload_url=upload_url,
            expires_in=self.settings.presigned_url_expiry_seconds,
        )

    def create_presigned_read_url(self, object_key: str, expires_in: int = 300) -> str:
        """Generate a temporary read URL so private photos are never exposed publicly."""
        return str(
            self.client.generate_presigned_url(
                ClientMethod="get_object",
                Params={"Bucket": self.bucket, "Key": object_key},
                ExpiresIn=expires_in,
            )
        )

    def download_bytes(self, object_key: str) -> bytes:
        response = self.client.get_object(Bucket=self.bucket, Key=object_key)
        body: bytes = response["Body"].read()
        return body

    def upload_bytes(
        self,
        object_key: str,
        data: bytes,
        content_type: str = "image/webp",
    ) -> None:
        self.client.put_object(
            Bucket=self.bucket,
            Key=object_key,
            Body=data,
            ContentType=content_type,
        )

    @staticmethod
    def strip_exif_and_encode_webp(
        raw_bytes: bytes, max_dimension: int = 1280
    ) -> bytes:
        """Remove GPS/device EXIF metadata, fix orientation, resize, and encode to WebP."""
        with Image.open(io.BytesIO(raw_bytes)) as img:
            # Apply EXIF orientation rotation before stripping metadata
            oriented = ImageOps.exif_transpose(img).convert("RGB")
            oriented.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)

            clean_img = Image.new("RGB", oriented.size)
            clean_img.putdata(list(oriented.getdata()))

            buffer = io.BytesIO()
            clean_img.save(buffer, format="WEBP", quality=88, method=4)
            return buffer.getvalue()
