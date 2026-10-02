"""brain items, owners and links — the company graph's own nodes and edges

Projects, clients, documents, decisions and threads. Tasks and meetings stay in
their own tables and are projected into the graph at read time.

Revision ID: e9b4c2d6f8a1
Revises: d5e8f1a3c7b2
Create Date: 2026-10-02 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'e9b4c2d6f8a1'
down_revision: Union[str, None] = 'd5e8f1a3c7b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

brain_item_kind = postgresql.ENUM(
    'project', 'client', 'meeting', 'document', 'task', 'decision', 'thread',
    name='brain_item_kind', create_type=False,
)
brain_item_status = postgresql.ENUM(
    'on_track', 'at_risk', 'blocked', 'done', 'pending_approval',
    name='brain_item_status', create_type=False,
)


def _common() -> list[sa.Column]:
    return [
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('company_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    ]


def upgrade() -> None:
    bind = op.get_bind()
    brain_item_kind.create(bind, checkfirst=True)
    brain_item_status.create(bind, checkfirst=True)

    op.create_table(
        'brain_items',
        *_common(),
        sa.Column('kind', brain_item_kind, nullable=False),
        sa.Column('title', sa.String(length=500), nullable=False),
        sa.Column('summary', sa.Text(), nullable=True),
        sa.Column('status', brain_item_status, nullable=True),
        sa.Column('source', sa.String(length=64), nullable=True),
        sa.Column('external_ref', sa.String(length=255), nullable=True),
        sa.Column('occurred_on', sa.Date(), nullable=True),
        sa.Column('external', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('department_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('team_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(['company_id'], ['companies.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['department_id'], ['departments.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['team_id'], ['teams.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('company_id', 'source', 'external_ref', name='uq_brain_items_source_ref'),
    )
    op.create_index(op.f('ix_brain_items_company_id'), 'brain_items', ['company_id'])
    op.create_index(op.f('ix_brain_items_department_id'), 'brain_items', ['department_id'])
    op.create_index(op.f('ix_brain_items_team_id'), 'brain_items', ['team_id'])

    op.create_table(
        'brain_item_owners',
        *_common(),
        sa.Column('item_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('employee_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(['company_id'], ['companies.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['item_id'], ['brain_items.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['employee_id'], ['employees.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('item_id', 'employee_id', name='uq_brain_item_owners_item_employee'),
    )
    op.create_index(op.f('ix_brain_item_owners_company_id'), 'brain_item_owners', ['company_id'])
    op.create_index(op.f('ix_brain_item_owners_item_id'), 'brain_item_owners', ['item_id'])
    op.create_index(op.f('ix_brain_item_owners_employee_id'), 'brain_item_owners', ['employee_id'])

    op.create_table(
        'brain_links',
        *_common(),
        sa.Column('source_ref', sa.String(length=80), nullable=False),
        sa.Column('target_ref', sa.String(length=80), nullable=False),
        sa.Column('relation', sa.String(length=64), nullable=True),
        sa.ForeignKeyConstraint(['company_id'], ['companies.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('company_id', 'source_ref', 'target_ref', name='uq_brain_links_pair'),
    )
    op.create_index(op.f('ix_brain_links_company_id'), 'brain_links', ['company_id'])
    op.create_index(op.f('ix_brain_links_source_ref'), 'brain_links', ['source_ref'])
    op.create_index('ix_brain_links_company_target', 'brain_links', ['company_id', 'target_ref'])


def downgrade() -> None:
    op.drop_index('ix_brain_links_company_target', table_name='brain_links')
    op.drop_index(op.f('ix_brain_links_source_ref'), table_name='brain_links')
    op.drop_index(op.f('ix_brain_links_company_id'), table_name='brain_links')
    op.drop_table('brain_links')
    op.drop_index(op.f('ix_brain_item_owners_employee_id'), table_name='brain_item_owners')
    op.drop_index(op.f('ix_brain_item_owners_item_id'), table_name='brain_item_owners')
    op.drop_index(op.f('ix_brain_item_owners_company_id'), table_name='brain_item_owners')
    op.drop_table('brain_item_owners')
    op.drop_index(op.f('ix_brain_items_team_id'), table_name='brain_items')
    op.drop_index(op.f('ix_brain_items_department_id'), table_name='brain_items')
    op.drop_index(op.f('ix_brain_items_company_id'), table_name='brain_items')
    op.drop_table('brain_items')
    bind = op.get_bind()
    brain_item_status.drop(bind, checkfirst=True)
    brain_item_kind.drop(bind, checkfirst=True)
