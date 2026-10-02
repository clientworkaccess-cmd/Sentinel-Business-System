# Sentinel API. Build from backend/:  docker build -t sentinel-api backend
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Dependencies first, so code changes don't reinstall them.
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

# Never run as root.
RUN useradd --create-home --uid 10001 sentinel && chown -R sentinel /app
USER sentinel

EXPOSE 8000

# Liveness only; orchestrators should route traffic on /ready (DB + schema at head).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"

ENTRYPOINT ["sh", "/app/docker-entrypoint.sh"]
