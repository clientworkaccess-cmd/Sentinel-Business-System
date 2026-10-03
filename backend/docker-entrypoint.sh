#!/bin/sh
# Migrate (once, when asked), then serve.
#
#   RUN_MIGRATIONS=true   run `alembic upgrade head` before starting. Set it on one
#                         instance (or a release job), not on every replica.
#   WEB_CONCURRENCY=N     uvicorn worker processes (default 2). The scheduler runs in
#                         each worker that has RUN_SCHEDULER=true — keep it to one
#                         process, e.g. a separate 1-worker container.
set -e

if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  alembic upgrade head
fi

exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "${PORT:-8000}" \
  --workers "${WEB_CONCURRENCY:-2}" \
  --proxy-headers \
  --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-127.0.0.1}"
