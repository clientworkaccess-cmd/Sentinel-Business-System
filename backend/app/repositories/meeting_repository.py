"""Repository for tenant-scoped meeting persistence."""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Sequence

from sqlalchemy import ColumnElement, exists, false, or_
from sqlalchemy.orm import Session

from app.models.meeting import Meeting, MeetingStatus, TranscriptSegment
from app.models.task import Task
from app.repositories.base import TenantScopedRepository

if TYPE_CHECKING:
    from app.core.visibility import Visibility


class MeetingRepository(TenantScopedRepository[Meeting]):
    model = Meeting

    def __init__(
        self, db: Session, company_id: uuid.UUID, visibility: "Visibility | None" = None
    ):
        super().__init__(db, company_id, visibility)

    def _visible_clause(self, visibility: "Visibility") -> ColumnElement[bool]:
        """A meeting someone in reach spoke in, or that produced a task they own.

        Meetings have no attendee list, so these are the two links that exist. The
        task link is ``tasks.meeting_id``, never the title in ``source_ref``: titles
        repeat ("Weekly Standup"), and a title match would hand one team's
        transcript to anyone owning a task from another team's meeting of that name.
        """
        if not visibility.employee_ids:
            return false()
        people = visibility.employee_ids
        spoke = exists().where(
            TranscriptSegment.meeting_id == Meeting.id,
            TranscriptSegment.speaker_employee_id.in_(people),
        )
        owns_task = exists().where(
            Task.company_id == Meeting.company_id,
            Task.meeting_id == Meeting.id,
            Task.owner_employee_id.in_(people),
        )
        return or_(spoke, owns_task)

    def list_recent(self, limit: int = 50) -> Sequence[Meeting]:
        """List meetings ordered by recorded_at descending."""
        stmt = (
            self._scoped()
            .order_by(Meeting.recorded_at.desc())
            .limit(limit)
        )
        return self.db.scalars(stmt).all()

    def create_meeting(
        self,
        *,
        title: str,
        audio_filename: str | None = None,
        audio_format: str | None = None,
        raw_transcript: str | None = None,
        status: MeetingStatus = MeetingStatus.PENDING,
        duration_seconds: int | None = None,
        recorded_at: datetime | None = None,
    ) -> Meeting:
        """Create a new tenant meeting record."""
        meeting = Meeting(
            company_id=self.company_id,
            title=title,
            audio_filename=audio_filename,
            audio_format=audio_format,
            raw_transcript=raw_transcript,
            status=status,
            duration_seconds=duration_seconds,
        )
        # Left to the column default when the caller does not know the real date.
        if recorded_at is not None:
            meeting.recorded_at = recorded_at
        self.db.add(meeting)
        self.db.commit()
        self.db.refresh(meeting)
        return meeting

    def add_segment(
        self,
        meeting_id: uuid.UUID,
        *,
        text: str,
        start_time: float = 0.0,
        end_time: float = 0.0,
        speaker_label: str = "Speaker 1",
        speaker_employee_id: uuid.UUID | None = None,
    ) -> TranscriptSegment:
        """Add a transcript segment to a meeting."""
        seg = TranscriptSegment(
            company_id=self.company_id,
            meeting_id=meeting_id,
            text=text,
            start_time=start_time,
            end_time=end_time,
            speaker_label=speaker_label,
            speaker_employee_id=speaker_employee_id,
        )
        self.db.add(seg)
        self.db.commit()
        self.db.refresh(seg)
        return seg
