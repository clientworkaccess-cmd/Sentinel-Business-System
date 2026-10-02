"""index reports.report_date

The model has declared ``index=True`` on reports.report_date since the reports
table was added, but that migration never created the index, so autogenerate kept
proposing it. Created here; IF NOT EXISTS because a database built by
``create_all`` already has it.

Revision ID: a7b8c9d0e1f2
Revises: f1c2d3e4a5b6
Create Date: 2026-10-03 00:30:00.000000

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a7b8c9d0e1f2'
down_revision: Union[str, None] = 'f1c2d3e4a5b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute('CREATE INDEX IF NOT EXISTS ix_reports_report_date ON reports (report_date)')


def downgrade() -> None:
    op.execute('DROP INDEX IF EXISTS ix_reports_report_date')
