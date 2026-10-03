"""The Composio seam — the only module that talks to Composio.

Composio does two jobs for us:

* **OAuth broker.** ``link()`` returns a hosted consent URL (Composio-managed apps,
  so no custom branding). Composio stores and refreshes the tokens; we keep only the
  connected-account id.
* **Authenticated proxy.** ``get()`` calls the provider's own REST API (Gmail,
  Calendar, Drive, Slack) through ``tools.proxy``, with Composio injecting the
  user's token. We use the providers' documented APIs rather than Composio's tool
  wrappers so incremental sync (historyId, syncToken) works exactly as the provider
  documents it, and no toolkit version pin can drift underneath us.

The SDK is synchronous. Everything here runs in threadpool routes or the scheduler,
never on the event loop.

Errors are translated into three types the rest of the code acts on:
``ProviderAuthError`` (reconnect needed), ``ProviderRateLimited`` (back off) and
``ProviderError`` (anything else). Provider payloads never go into an exception
message, because messages reach logs and the UI.
"""

from __future__ import annotations

import logging
import random
import threading
import time
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Protocol

from app.config import settings

logger = logging.getLogger(__name__)

#: Composio statuses, mapped onto ours in app/connectors/service.py.
ACTIVE = "ACTIVE"
PENDING_STATES = frozenset({"INITIALIZING", "INITIATED"})
DEAD_STATES = frozenset({"EXPIRED", "REVOKED", "INACTIVE"})
FAILED_STATES = frozenset({"FAILED"})

#: Attempts for one proxied GET: transient 5xx and 429 are retried with backoff.
MAX_ATTEMPTS = 4


class ProviderError(Exception):
    """A provider or Composio call failed. ``str()`` is safe to show a user."""


class ProviderAuthError(ProviderError):
    """The grant is gone (401/403, revoked, expired). Only a reconnect fixes it."""


class ProviderRateLimited(ProviderError):
    """Still throttled after retries. The next scheduled sync picks up from the cursor."""


class ProviderNotFound(ProviderError):
    """404/410. Callers use it to detect an expired sync cursor."""


class ConnectorsUnavailable(ProviderError):
    """COMPOSIO_API_KEY is not set."""


@dataclass(frozen=True)
class LinkResult:
    account_id: str
    redirect_url: str


@dataclass(frozen=True)
class AccountState:
    status: str
    reason: str | None
    user_id: str | None
    toolkit: str | None


class Gateway(Protocol):
    """What connectors and the service may assume. Tests substitute a fake."""

    def link(self, *, user_ref: str, toolkit: str, callback_url: str) -> LinkResult: ...

    def account(self, account_id: str) -> AccountState: ...

    def delete(self, account_id: str) -> None: ...

    def get(
        self, account_id: str, url: str, params: dict[str, Any] | None = None
    ) -> Any: ...

    def get_text(self, account_id: str, url: str, params: dict[str, Any] | None = None) -> str: ...


def _no_tracking() -> None:
    """Keep Composio's usage telemetry off in *this* thread.

    The SDK's ``allow_tracking`` is a ContextVar set where the client is built, so
    syncs on scheduler and background-task threads fell back to its default (on)
    and posted an invocation metric per provider call. Called at the top of every
    public gateway method, so no thread can miss it.
    """
    from composio.core.models.base import allow_tracking

    allow_tracking.set(False)


class ComposioGateway:
    """The real gateway. One instance per process; the SDK client is thread-safe."""

    def __init__(self, api_key: str) -> None:
        from composio import Composio  # imported lazily: optional at import time

        _no_tracking()
        self._client = Composio(api_key=api_key, allow_tracking=False, timeout=60)
        self._auth_configs: dict[str, str] = {}
        self._lock = threading.Lock()

    # --- OAuth -------------------------------------------------------------------

    def auth_config_id(self, toolkit: str) -> str:
        """The Composio-managed auth config for a toolkit, found or created once."""
        _no_tracking()
        pinned = getattr(settings, f"composio_auth_config_{toolkit}", "").strip()
        if pinned:
            return pinned
        with self._lock:
            if toolkit in self._auth_configs:
                return self._auth_configs[toolkit]
            try:
                found = self._client.auth_configs.list(toolkit_slug=toolkit, is_composio_managed=True)
                enabled = [c for c in found.items if getattr(c, "status", "ENABLED") == "ENABLED"]
                if enabled:
                    chosen = max(enabled, key=lambda c: getattr(c, "created_at", "") or "").id
                else:
                    chosen = self._client.auth_configs.create(
                        toolkit, {"type": "use_composio_managed_auth", "name": f"Sentinel {toolkit}"}
                    ).id
                    logger.info("Created Composio-managed auth config for %s", toolkit)
            except Exception as exc:  # noqa: BLE001 - translated, never re-raised raw
                raise _translate(exc, f"set up {toolkit}") from None
            self._auth_configs[toolkit] = chosen
            return chosen

    def link(self, *, user_ref: str, toolkit: str, callback_url: str) -> LinkResult:
        _no_tracking()
        auth_config = self.auth_config_id(toolkit)
        try:
            # allow_multiple: a reconnect after expiry creates a fresh account while
            # Composio may still list the old one; we delete the old one ourselves.
            request = self._client.connected_accounts.link(
                user_ref, auth_config, callback_url=callback_url, allow_multiple=True
            )
        except Exception as exc:  # noqa: BLE001
            raise _translate(exc, f"start the {toolkit} sign-in") from None
        if not request.redirect_url:
            raise ProviderError(f"Composio did not return a sign-in link for {toolkit}.")
        return LinkResult(account_id=request.id, redirect_url=request.redirect_url)

    def account(self, account_id: str) -> AccountState:
        _no_tracking()
        try:
            acc = self._client.connected_accounts.get(account_id)
        except Exception as exc:  # noqa: BLE001
            raise _translate(exc, "read the connection") from None
        toolkit = getattr(getattr(acc, "toolkit", None), "slug", None)
        return AccountState(
            status=str(acc.status), reason=getattr(acc, "status_reason", None),
            user_id=getattr(acc, "user_id", None), toolkit=toolkit,
        )

    def delete(self, account_id: str) -> None:
        _no_tracking()
        try:
            self._client.connected_accounts.delete(account_id)
        except Exception as exc:  # noqa: BLE001
            err = _translate(exc, "remove the connection")
            if isinstance(err, ProviderNotFound):
                return  # already gone: the outcome we wanted
            raise err from None

    # --- provider API ------------------------------------------------------------

    def get(self, account_id: str, url: str, params: dict[str, Any] | None = None) -> Any:
        """GET a provider endpoint as the account's owner. Returns the parsed body."""
        response = self._proxy(account_id, url, params)
        data = response.data
        if data is None and getattr(response, "binary_data", None) is not None:
            raise ProviderError("The provider returned a file where data was expected.")
        return data

    def get_text(self, account_id: str, url: str, params: dict[str, Any] | None = None) -> str:
        """GET an endpoint that returns text (e.g. a Google Doc exported as text/plain).

        Composio returns small text bodies inline and larger ones as a short-lived
        download URL; both are handled.
        """
        response = self._proxy(account_id, url, params)
        if isinstance(response.data, str):
            return response.data
        binary = getattr(response, "binary_data", None)
        if binary is not None and getattr(binary, "url", None):
            import httpx

            try:
                fetched = httpx.get(binary.url, timeout=60, follow_redirects=True)
                fetched.raise_for_status()
            except httpx.HTTPError:
                raise ProviderError("Could not download the exported file.") from None
            return fetched.content.decode("utf-8", errors="replace")
        if response.data is None:
            return ""
        return str(response.data)

    def _proxy(self, account_id: str, url: str, params: dict[str, Any] | None) -> Any:
        _no_tracking()
        query = [
            {"name": k, "type": "query", "value": str(v)}
            for k, v in (params or {}).items()
            if v is not None
        ]
        delay = 1.0
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                response = self._client.tools.proxy(
                    endpoint=url, method="GET", connected_account_id=account_id, parameters=query
                )
            except Exception as exc:  # noqa: BLE001
                err = _translate(exc, "reach the provider")
                if isinstance(err, ProviderRateLimited | _Transient) and attempt < MAX_ATTEMPTS:
                    time.sleep(delay + random.random())
                    delay *= 2
                    continue
                raise (err if not isinstance(err, _Transient) else ProviderError(str(err))) from None

            status = int(getattr(response, "status", 200) or 200)
            if status < 400:
                return response
            if status in (401, 403):
                # Slack answers 200 with ok=false instead; see slack.py. Google's 403s
                # include quota errors, which are told apart by their reason.
                if status == 403 and _is_quota(response.data):
                    status = 429
                elif attempt == 1:
                    # Often an access token that expired mid-sync: one more try lets
                    # Composio refresh it. Found in a live Drive sync.
                    time.sleep(1.0)
                    continue
                else:
                    raise ProviderAuthError("The provider no longer accepts this connection. Reconnect it.")
            if status in (404, 410):
                raise ProviderNotFound(f"The provider returned {status}.")
            if (status == 429 or status >= 500) and attempt < MAX_ATTEMPTS:
                retry_after = _retry_after(getattr(response, "headers", None))
                time.sleep(retry_after if retry_after is not None else delay + random.random())
                delay *= 2
                continue
            if status == 429:
                raise ProviderRateLimited("The provider is rate-limiting us. Sync will resume later.")
            raise ProviderError(f"The provider returned {status}.")
        raise ProviderError("The provider did not respond.")  # pragma: no cover


class _Transient(ProviderError):
    """A network or 5xx failure worth one more try."""


def _translate(exc: Exception, doing: str) -> ProviderError:
    """Map an SDK/HTTP exception onto our types without leaking its payload."""
    status = getattr(exc, "status_code", None) or getattr(getattr(exc, "response", None), "status_code", None)
    name = type(exc).__name__
    logger.warning("Composio call failed while trying to %s: %s (status=%s)", doing, name, status)
    if status in (401, 403):
        # A 401 from Composio itself means our API key is wrong, not the user's grant.
        return ConnectorsUnavailable("The Composio API key was rejected. Check COMPOSIO_API_KEY.")
    if status == 404:
        return ProviderNotFound(f"Could not {doing}: not found.")
    if status == 429:
        return ProviderRateLimited(f"Could not {doing}: rate limited.")
    if status is None or status >= 500 or "Timeout" in name or "Connection" in name:
        return _Transient(f"Could not {doing}: the service is unavailable.")
    return ProviderError(f"Could not {doing}.")


def _retry_after(headers: dict[str, str] | None) -> float | None:
    if not headers:
        return None
    value = next((v for k, v in headers.items() if k.lower() == "retry-after"), None)
    try:
        return min(float(value), 60.0) if value is not None else None
    except ValueError:
        return None


def _is_quota(data: Any) -> bool:
    """Google signals rate limits as 403 with reason rateLimitExceeded / userRateLimitExceeded."""
    try:
        errors = data["error"]["errors"]
        return any("RateLimit" in (e.get("reason") or "") for e in errors)
    except (TypeError, KeyError):
        return False


# --- process-wide instance ----------------------------------------------------------

_override: Gateway | None = None


def set_gateway(gateway: Gateway | None) -> None:
    """Swap the gateway (tests and scripts/verify_connectors.py)."""
    global _override
    _override = gateway
    _real_gateway.cache_clear()


@lru_cache(maxsize=1)
def _real_gateway() -> ComposioGateway | None:
    if not settings.connectors_enabled:
        return None
    return ComposioGateway(settings.composio_api_key.strip())


def get_gateway() -> Gateway | None:
    """The active gateway, or None when connectors are not configured."""
    return _override if _override is not None else _real_gateway()


def require_gateway() -> Gateway:
    gateway = get_gateway()
    if gateway is None:
        raise ConnectorsUnavailable("Connectors are not configured on this server (COMPOSIO_API_KEY).")
    return gateway
