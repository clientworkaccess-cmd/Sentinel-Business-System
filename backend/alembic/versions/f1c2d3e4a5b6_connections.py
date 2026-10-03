"""connections — one person's account on one connector, brokered by Composio

Composio holds the OAuth tokens; this table holds only its account id, the cached
status, and the incremental-sync cursor. brain_items gains connection_id so a
disconnect can remove exactly what that account brought in.

Revision ID: f1c2d3e4a5b6
Revises: e9b4c2d6f8a1
Create Date: 2026-10-02 23:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'f1c2d3e4a5b6'
down_revision: Union[str, None] = 'e9b4c2d6f8a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

connection_status = postgresql.ENUM(
    'pending', 'active', 'expired', 'failed', name='connection_status', create_type=False,
)


def upgrade() -> None:
    connection_status.create(op.get_bind(), checkfirst=True)

    op.create_table(
        'connections',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('company_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('connector_id', sa.String(length=64), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('composio_account_id', sa.String(length=128), nullable=False),
        sa.Column('status', connection_status, server_default='pending', nullable=False),
        sa.Column('status_reason', sa.Text(), nullable=True),
        sa.Column('account_label', sa.String(length=320), nullable=True),
        sa.Column('sync_cursor', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
        sa.Column('sync_started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_synced_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_sync_error', sa.Text(), nullable=True),
        sa.Column('item_count', sa.Integer(), server_default='0', nullable=False),
        sa.ForeignKeyConstraint(['company_id'], ['companies.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('company_id', 'user_id', 'connector_id', name='uq_connections_user_connector'),
        sa.UniqueConstraint('composio_account_id', name='uq_connections_composio_account'),
    )
    op.create_index(op.f('ix_connections_company_id'), 'connections', ['company_id'], unique=False)
    op.create_index(op.f('ix_connections_connector_id'), 'connections', ['connector_id'], unique=False)
    op.create_index(op.f('ix_connections_user_id'), 'connections', ['user_id'], unique=False)

    op.add_column('brain_items', sa.Column('connection_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index(op.f('ix_brain_items_connection_id'), 'brain_items', ['connection_id'], unique=False)
    op.create_foreign_key(
        'brain_items_connection_id_fkey', 'brain_items', 'connections',
        ['connection_id'], ['id'], ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint('brain_items_connection_id_fkey', 'brain_items', type_='foreignkey')
    op.drop_index(op.f('ix_brain_items_connection_id'), table_name='brain_items')
    op.drop_column('brain_items', 'connection_id')
    op.drop_index(op.f('ix_connections_user_id'), table_name='connections')
    op.drop_index(op.f('ix_connections_connector_id'), table_name='connections')
    op.drop_index(op.f('ix_connections_company_id'), table_name='connections')
    op.drop_table('connections')
    connection_status.drop(op.get_bind(), checkfirst=True)
