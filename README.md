# kinetix-ai (AI Physique & Adaptive Training Engine)

## What is this?

kinetix-ai is a high-precision AI physique tracking and adaptive workout engine that analyzes progress photos against your goal physique and generates daily training tasks tailored to your available equipment.

I built this to track my own body transformation and fitness progression using deterministic computer vision alongside frontier multimodal AI without relying on guesswork or generic fitness templates. I have wondered for a while if AI can be used to replace personal trainers, this application will test that.

It will start as a web app at first and could possibly be transitioned into a mobile app.

You can run the full stack locally with Docker or deploy it directly to cloud infrastructure.

---

## How I built it

### Technologies

- Python 3.12 & FastAPI (Async API layer)
- PydanticAI (Contract-first structured VLM outputs & provider failover)
- MediaPipe & OpenCV (Skeletal pose landmark normalization & anthropometric ratios)
- PostgreSQL & Redis (Multi-tenant persistence & rate limiting)
- Cloudflare R2 / S3 (Presigned direct image uploads with EXIF stripping)
- Pydantic Logfire (OpenTelemetry distributed tracing & LLM cost/latency monitoring)
- Docker & uv (Reproducible multi-stage container builds)

### How it works

1. **Lines up the photos first:** Before any AI sees your pictures, MediaPipe finds your body landmarks (shoulders, waist, hips) to line up the angles and zoom across your starting, current, and goal photos, and measures your shoulder-to-waist ratio.
2. **Compares your progress:** PydanticAI sends those lined-up photos and measurements to a vision model (with a backup model just in case) to give honest, structured feedback on what’s actually changing.
3. **Builds your daily workout:** It takes your current progress and whatever equipment you have available if any to give you a clear set of workout tasks for the day.

---

## How to use it

1. Clone the repository:

   ```bash
   git clone [https://github.com/](https://github.com/)emmanueluwa/kinetix-ai.git
   cd kinetix-ai

   ```

2. Copy the environment template and add your API keys:

   ```bash
   cp backend/.env.example backend/.env

   cd backend && uv sync && uv run uvicorn app.main:app --reload
   ```
