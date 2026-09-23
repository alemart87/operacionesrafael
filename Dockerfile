# === Stage 1: build frontend (Next.js standalone) ===
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build && \
    test -f /app/frontend/.next/standalone/server.js && \
    test -d /app/frontend/.next/static

# === Stage 2: runtime (Python + Node 20) ===
FROM python:3.12-slim AS runtime
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends \
      libpq-dev gcc curl ca-certificates gnupg dos2unix \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Backend
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --upgrade pip && pip install -r /app/backend/requirements.txt
COPY backend/ /app/backend/

# Frontend standalone (contiene server.js + .next/server + node_modules mínimos)
COPY --from=frontend-builder /app/frontend/public            /app/frontend/public
COPY --from=frontend-builder /app/frontend/.next/standalone  /app/frontend
COPY --from=frontend-builder /app/frontend/.next/static      /app/frontend/.next/static

# Startup script (forzar LF y permisos por si el repo trae CRLF)
COPY start.sh /app/start.sh
RUN dos2unix /app/start.sh && chmod +x /app/start.sh

# Directorio de uploads (en runtime se monta el disco persistente arriba)
RUN mkdir -p /var/data/uploads

ENV PORT=8080 \
    BACKEND_URL=http://127.0.0.1:8000 \
    UPLOAD_DIR=/var/data/uploads

EXPOSE 8080

CMD ["/app/start.sh"]
