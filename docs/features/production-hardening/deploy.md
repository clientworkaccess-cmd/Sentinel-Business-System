# Deploying the Sentinel API

## Image
`docker build -t sentinel-api backend`. Python 3.12-slim. It runs as a non-root user and serves on `$PORT` (default 8000).

| Env | Purpose |
|---|---|
| `DATABASE_CONNECTION_STRING` | Neon URL (`postgresql://…?sslmode=require`). The `-pooler` host is detected and prepared statements are turned off for it. |
| `JWT_SECRET_KEY` | ≥ 32 chars. Startup refuses the placeholder unless `ENVIRONMENT` is dev/local/test. |
| `ENVIRONMENT=production` | Turns off `/docs`. |
| `CORS_ORIGINS` | The frontend origin(s), comma-separated. |
| `RUN_MIGRATIONS=true` | Runs `alembic upgrade head` before serving. Set it on **one** instance or a release job. |
| `RUN_SCHEDULER` | The daily chase and connector sync. **Exactly one process** should have it `true`: run the web replicas with `false` plus one 1-worker container with `true`. Otherwise every worker sends the daily chase. |
| `WEB_CONCURRENCY` | Uvicorn workers (default 2). |
| `FORWARDED_ALLOW_IPS` | The proxy's IP(s), so `--proxy-headers` trusts only it. |
| `QWEN_API_KEY`, `COMPOSIO_API_KEY`, `HYDRA_DB_API_KEY` | Optional. When one is missing, its feature returns a clean 503 and nothing else is affected. |
| `PUBLIC_API_URL`, `FRONTEND_URL` | Connector OAuth return path (see `docs/features/connectors/`). |

## Probes
- `GET /health` is liveness. It never touches the database.
- `GET /ready` is readiness. It returns 200 only when the database answers **and** its Alembic revision matches the code's head. Otherwise 503 with the reason, e.g. `schema: at f1c2…, expected a7b8…`. Route traffic on this probe so that a deploy whose migration hasn't run takes no requests.

## CI (`.github/workflows/`)
- **backend.yml** runs on a throwaway Postgres 16 service, never Neon:
  1. a syntax / undefined-name lint;
  2. migrations from scratch;
  3. a full downgrade → upgrade round trip;
  4. a model ↔ migration drift check;
  5. every verify suite.
  - It runs with no model, Composio or HydraDB key, so it covers the keyless paths. The checks that need a live model are reported as skipped.
- **frontend.yml** runs `tsc` and `next build` in both login modes.

## Hardening in this change
- **AI endpoints:** chat and meetings return a 503 `UNAVAILABLE` when no model is configured, and refuse *before* writing any row. Previously they wrote a half-made meeting and then failed with a 500.
- **Response headers:** every response carries `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and `Cross-Origin-Resource-Policy`.
- **Request ids:** a caller's `X-Request-ID` is echoed and logged only if it matches `[A-Za-z0-9._-]{1,64}`, so it can't forge log lines.
- **Schema:** the missing `ix_reports_report_date` index is added, and models and migrations now agree exactly.
