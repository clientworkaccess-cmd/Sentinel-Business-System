"""Model package.

Every model is imported here so Base.metadata is complete when Alembic
autogenerates. A model that is not imported is a table Alembic will silently
propose dropping.
"""

from app.models.approval import Approval
from app.models.audit_log import AuditLog
from app.models.base import Base, TenantMixin, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.brain import BrainItem, BrainItemOwner, BrainLink
from app.models.company import Company
from app.models.conversation import Conversation
from app.models.employee import Employee
from app.models.enums import (
    ApprovalState,
    BrainItemKind,
    BrainItemStatus,
    MessageAudience,
    MessageChannel,
    OutboundStatus,
    ReportedVia,
    TaskStatus,
    UserRole,
)
from app.models.meeting import Meeting, MeetingStatus, TranscriptSegment
from app.models.org import AdminAssignment, Department, Team, TeamMembership
from app.models.outbound_message import OutboundMessage
from app.models.report import Report
from app.models.status_update import StatusUpdate
from app.models.task import Task
from app.models.user import User

__all__ = [
    "AdminAssignment",
    "Approval",
    "ApprovalState",
    "AuditLog",
    "Base",
    "BrainItem",
    "BrainItemKind",
    "BrainItemOwner",
    "BrainItemStatus",
    "BrainLink",
    "Company",
    "Conversation",
    "Department",
    "Employee",
    "Meeting",
    "MeetingStatus",
    "MessageAudience",
    "MessageChannel",
    "OutboundMessage",
    "OutboundStatus",
    "Report",
    "ReportedVia",
    "StatusUpdate",
    "Task",
    "TaskStatus",
    "Team",
    "TeamMembership",
    "TenantMixin",
    "TimestampMixin",
    "TranscriptSegment",
    "UUIDPrimaryKeyMixin",
    "User",
    "UserRole",
]
