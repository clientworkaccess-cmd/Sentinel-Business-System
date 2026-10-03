"""outbound message approval gate

Every message Sentinel would send lands here as pending_approval. External ones can
only be cleared by a human — enforced by ck_outbound_external_needs_human, not just
by the service. Companies get auto_send_internal_followups (off), the one policy
that can clear a message automatically, and only an internal one.

Revision ID: d5e8f1a3c7b2
Revises: c3a7e1f2b9d4
Create Date: 2026-10-02 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'd5e8f1a3c7b2'
down_revision: Union[str, None] = 'c3a7e1f2b9d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

message_channel = postgresql.ENUM(
    'email', 'whatsapp', 'slack', 'slack_connect', 'in_app', name='message_channel', create_type=False
)
message_audience = postgresql.ENUM('internal', 'external', name='message_audience', create_type=False)
outbound_status = postgresql.ENUM(
    'pending_approval', 'approved', 'rejected', 'sent', 'failed', name='outbound_status', create_type=False
)


def upgrade() -> None:
    bind = op.get_bind()
    message_channel.create(bind, checkfirst=True)
    message_audience.create(bind, checkfirst=True)
    outbound_status.create(bind, checkfirst=True)

    op.add_column(
        'companies',
        sa.Column('auto_send_internal_followups', sa.Boolean(), server_default='false', nullable=False),
    )

    op.create_table(
        'outbound_messages',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('company_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('channel', message_channel, nullable=False),
        sa.Column('audience', message_audience, nullable=False),
        sa.Column('status', outbound_status, server_default='pending_approval', nullable=False),
        sa.Column('recipient_address', sa.String(length=320), nullable=False),
        sa.Column('recipient_name', sa.String(length=200), nullable=True),
        sa.Column('recipient_employee_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('subject', sa.String(length=500), nullable=True),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('task_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('thread_ref', sa.String(length=255), nullable=True),
        sa.Column('drafted_by_agent', sa.String(length=64), nullable=True),
        sa.Column('drafted_by_user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('approved_via', sa.String(length=16), nullable=True),
        sa.Column('decided_by_user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('rejection_reason', sa.Text(), nullable=True),
        sa.Column('edited_payload', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('provider_message_id', sa.String(length=255), nullable=True),
        sa.Column('delivery_error', sa.Text(), nullable=True),
        sa.Column('idempotency_key', sa.String(length=255), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['company_id'], ['companies.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['recipient_employee_id'], ['employees.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['drafted_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['decided_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.CheckConstraint(
            "audience <> 'external' OR status NOT IN ('approved', 'sent', 'failed') "
            "OR decided_by_user_id IS NOT NULL",
            name='ck_outbound_external_needs_human',
        ),
        sa.UniqueConstraint('company_id', 'idempotency_key', name='uq_outbound_company_idempotency'),
    )
    op.create_index(op.f('ix_outbound_messages_company_id'), 'outbound_messages', ['company_id'])
    op.create_index(op.f('ix_outbound_messages_status'), 'outbound_messages', ['status'])
    op.create_index(
        'ix_outbound_company_status_created', 'outbound_messages', ['company_id', 'status', 'created_at']
    )


def downgrade() -> None:
    op.drop_index('ix_outbound_company_status_created', table_name='outbound_messages')
    op.drop_index(op.f('ix_outbound_messages_status'), table_name='outbound_messages')
    op.drop_index(op.f('ix_outbound_messages_company_id'), table_name='outbound_messages')
    op.drop_table('outbound_messages')
    op.drop_column('companies', 'auto_send_internal_followups')
    bind = op.get_bind()
    outbound_status.drop(bind, checkfirst=True)
    message_audience.drop(bind, checkfirst=True)
    message_channel.drop(bind, checkfirst=True)
