# BoardGuard: one container = OpenCV 5 vision API + bundled workstation UI.
# Runs unchanged locally (docker run -p 8080:8080), on AWS Lambda (via the
# AWS Lambda Web Adapter extension), App Runner or ECS.

# ---- 1. Static workstation UI -------------------------------------------------
FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY apps/web/ ./
# Same-origin API in production: the UI calls /api/* on the host that served it.
ENV NEXT_PUBLIC_API_BASE="" NEXT_TELEMETRY_DISABLED=1
RUN rm -f .env.development && npx next build

# ---- 2. Vision API runtime ----------------------------------------------------
FROM python:3.11-slim-bookworm
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.9.1 /lambda-adapter /opt/extensions/lambda-adapter

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    PORT=8080 \
    AWS_LWA_PORT=8080 \
    AWS_LWA_READINESS_CHECK_PATH=/api/health \
    BOARDGUARD_FIXTURES_DIR=/srv/fixtures \
    BOARDGUARD_STATIC_DIR=/srv/ui \
    BOARDGUARD_DATA_DIR=/tmp/boardguard

WORKDIR /srv/api
COPY services/vision-api/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && python -c "import cv2; assert cv2.__version__.startswith('5.'), cv2.__version__; print('OpenCV', cv2.__version__)"
COPY services/vision-api/app ./app
COPY datasets/fixtures /srv/fixtures
COPY --from=web /web/out /srv/ui

RUN useradd --uid 10001 --no-create-home boardguard
USER 10001
EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1 --no-access-log"]
