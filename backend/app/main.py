import logging
from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.api.router import api_router
from app.config import settings
from app.core.scheduler import shutdown_scheduler, start_scheduler
from app.database import engine
from app.exceptions import register_exception_handlers
from app.middleware import RequestContextMiddleware

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.run_scheduler:
        start_scheduler()
    yield
    shutdown_scheduler()


app = FastAPI(
    title="Sentinel API",
    description="Operational layer for a business: captures decisions, tracks who owes what, chases until done.",
    version="0.1.0",
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None,
    lifespan=lifespan,
)

app.add_middleware(RequestContextMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_exception_handlers(app)
app.include_router(api_router)


@app.get("/health", tags=["health"])
def health() -> dict[str, str]:
    """Liveness probe. Does not touch the database."""
    return {"status": "ok", "environment": settings.environment}


@app.get("/ready", tags=["health"])
def ready() -> JSONResponse:
    """Readiness probe: the database answers and its schema is the one this code expects.

    503 until both hold, so a load balancer never routes to an instance that would
    fail every query — e.g. a deploy whose migration has not run yet.
    """
    checks: dict[str, str] = {}
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            current = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one_or_none()
        checks["database"] = "ok"
        head = _migration_head()
        checks["schema"] = "ok" if current == head else f"at {current}, expected {head}"
    except Exception as exc:  # noqa: BLE001 - any failure means not ready
        checks.setdefault("database", f"unavailable ({type(exc).__name__})")
    ok = all(v == "ok" for v in checks.values()) and "schema" in checks
    return JSONResponse(status_code=200 if ok else 503, content={"status": "ready" if ok else "not_ready", **checks})


@lru_cache
def _migration_head() -> str | None:
    """The newest revision in alembic/versions, read once from the files on disk."""
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    root = Path(__file__).resolve().parents[1]
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "alembic"))
    return ScriptDirectory.from_config(config).get_current_head()
