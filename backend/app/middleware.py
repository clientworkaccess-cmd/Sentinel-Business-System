"""Request-scoped middleware: correlation id and timing."""

import logging
import re
import time
import uuid
from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)

#: A caller-supplied id is echoed and logged, so it must not be able to forge a log
#: line (newlines) or bloat one. Anything else gets a fresh id.
_SAFE_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")

#: Sent on every response. The API serves JSON only, so the strict defaults cost nothing.
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-site",
}


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Tags each request with an id and logs its duration.

    The id is echoed as X-Request-ID so a user-reported error can be traced to a
    log line. Never logs headers or bodies - they carry tokens and passwords.
    """

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        supplied = request.headers.get("X-Request-ID", "")
        request_id = supplied if _SAFE_REQUEST_ID.match(supplied) else str(uuid.uuid4())
        request.state.request_id = request_id

        started = time.perf_counter()
        response = await call_next(request)
        duration_ms = (time.perf_counter() - started) * 1000

        response.headers["X-Request-ID"] = request_id
        for header, value in SECURITY_HEADERS.items():
            response.headers.setdefault(header, value)
        logger.info(
            "%s %s -> %s (%.1fms) [%s]",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
            request_id,
        )
        return response
