"""FastAPI dependencies: authentication, tenant resolution, role and visibility checks.

get_current_user is where the tenancy boundary is drawn. company_id comes from the
signed token and nowhere else — never a request body, query param, or header.

Two kinds of gate live here, and every route uses one of them:

* **Visibility** (``Viewer``) for reads. Resolves what the caller may see once, and
  the scoped repositories below apply it to every query. Routes never filter by role
  themselves.
* **Role** (``require_roles`` / ``OwnerUser``) for writes and owner-only surfaces.
"""

import uuid
from collections.abc import Callable
from typing import Annotated

from fastapi import Depends
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.core.visibility import Visibility, resolve_visibility
from app.database import get_db
from app.exceptions import ForbiddenError, InactiveUserError, NotAuthenticatedError
from app.models.enums import UserRole
from app.models.user import User
from app.repositories.company import CompanyRepository
from app.repositories.approval import ApprovalRepository
from app.repositories.employee import EmployeeRepository
from app.repositories.task import TaskRepository
from app.repositories.user import UserRepository, get_user_by_id
from app.services.approval_service import ApprovalService
from app.services.employee_service import EmployeeService
from app.services.onboarding_service import OnboardingService
from app.services.task_service import TaskService

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)

DbSession = Annotated[Session, Depends(get_db)]

_SESSION_INVALID = "Your session is invalid or has expired."


def get_current_user(
    db: DbSession,
    token: Annotated[str | None, Depends(oauth2_scheme)],
) -> User:
    """Decode the token and load its subject.

    The user is re-checked against the token's company_id, so a token that survives
    a user being moved between tenants stops working rather than following them.
    The role and token-version claims must also still match the row: a role change,
    password change or deactivation ends every session issued before it, instead of
    letting them run to expiry.
    """
    if not token:
        raise NotAuthenticatedError()

    claims = decode_access_token(token)
    if claims is None:
        raise NotAuthenticatedError(_SESSION_INVALID)

    try:
        user_id = uuid.UUID(claims["sub"])
        company_id = uuid.UUID(claims["company_id"])
        role_claim = str(claims["role"])
        version_claim = int(claims.get("ver", 0))
    except (KeyError, TypeError, ValueError):
        raise NotAuthenticatedError(_SESSION_INVALID) from None

    user = get_user_by_id(db, user_id, company_id)
    if user is None or user.role.value != role_claim or user.token_version != version_claim:
        raise NotAuthenticatedError(_SESSION_INVALID)
    if not user.is_active:
        raise InactiveUserError()

    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def get_company_id(current_user: CurrentUser) -> uuid.UUID:
    """The tenant for this request. Always derived from the authenticated user."""
    return current_user.company_id


CompanyId = Annotated[uuid.UUID, Depends(get_company_id)]


# --- Visibility ------------------------------------------------------------------


def get_visibility(db: DbSession, current_user: CurrentUser) -> Visibility:
    """What the caller may read. Resolved once per request, then cached by FastAPI."""
    return resolve_visibility(db, current_user)


#: The read gate. Every read endpoint takes this (directly, or through one of the
#: scoped repositories/services below, which depend on it).
Viewer = Annotated[Visibility, Depends(get_visibility)]


# --- Roles -----------------------------------------------------------------------


def require_roles(*roles: UserRole) -> Callable[[User], User]:
    """A dependency admitting only the given roles. For writes and owner surfaces."""
    allowed = frozenset(roles)
    label = " or ".join(r.value for r in roles)

    def dependency(current_user: CurrentUser) -> User:
        if current_user.role not in allowed:
            raise ForbiddenError(f"This action is restricted to the {label} role.")
        return current_user

    return dependency


OwnerUser = Annotated[User, Depends(require_roles(UserRole.OWNER))]
OwnerOrAdminUser = Annotated[User, Depends(require_roles(UserRole.OWNER, UserRole.ADMIN))]

#: Deprecated name from the founder/employee model. Same gate as OwnerUser.
FounderUser = OwnerUser


def require_employee(current_user: CurrentUser) -> User:
    """Routes about "my own work" — any user linked to an employee row.

    Admins and Members both are; an Owner usually is not.
    """
    if current_user.employee_id is None:
        raise ForbiddenError("This action needs an account linked to an employee.")
    return current_user


EmployeeUser = Annotated[User, Depends(require_employee)]


def get_current_employee_id(employee_user: EmployeeUser) -> uuid.UUID:
    """Return the employee_id of the authenticated employee user."""
    return employee_user.employee_id  # type: ignore[return-value]


CurrentEmployeeId = Annotated[uuid.UUID, Depends(get_current_employee_id)]


# --- Tenant-scoped repositories -------------------------------------------------
# Routes take these rather than a bare session, so the company filter — and, for
# people-bearing data, the viewer's visibility — is applied before a handler can
# write a query.


def get_user_repository(db: DbSession, company_id: CompanyId) -> UserRepository:
    return UserRepository(db, company_id)


def get_employee_repository(
    db: DbSession, company_id: CompanyId, viewer: Viewer
) -> EmployeeRepository:
    return EmployeeRepository(db, company_id, viewer)


def get_company_repository(db: DbSession) -> CompanyRepository:
    return CompanyRepository(db)


def get_task_repository(db: DbSession, company_id: CompanyId, viewer: Viewer) -> TaskRepository:
    return TaskRepository(db, company_id, viewer)


def get_task_service(db: DbSession, company_id: CompanyId, viewer: Viewer) -> TaskService:
    return TaskService(db, company_id, viewer)


def get_approval_repository(db: DbSession, company_id: CompanyId) -> ApprovalRepository:
    return ApprovalRepository(db, company_id)


def get_employee_service(db: DbSession, company_id: CompanyId, viewer: Viewer) -> EmployeeService:
    return EmployeeService(db, company_id, viewer)


def get_approval_service(db: DbSession, company_id: CompanyId) -> ApprovalService:
    return ApprovalService(db, company_id)


def get_onboarding_service(db: DbSession, company_id: CompanyId) -> OnboardingService:
    return OnboardingService(db, company_id)


UserRepo = Annotated[UserRepository, Depends(get_user_repository)]
EmployeeRepo = Annotated[EmployeeRepository, Depends(get_employee_repository)]
CompanyRepo = Annotated[CompanyRepository, Depends(get_company_repository)]
TaskRepo = Annotated[TaskRepository, Depends(get_task_repository)]
TaskSvc = Annotated[TaskService, Depends(get_task_service)]
ApprovalRepo = Annotated[ApprovalRepository, Depends(get_approval_repository)]
EmployeeSvc = Annotated[EmployeeService, Depends(get_employee_service)]
ApprovalSvc = Annotated[ApprovalService, Depends(get_approval_service)]
OnboardingSvc = Annotated[OnboardingService, Depends(get_onboarding_service)]
