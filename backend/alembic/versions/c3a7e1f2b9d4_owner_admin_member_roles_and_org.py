"""owner / admin / member roles and the department → team org hierarchy

Founders become owners and employees become members by *renaming* the enum
values in place, so every existing row converts without an UPDATE and nothing can
be left behind half-migrated. 'admin' is new. Then the org tables an Admin's
visibility is computed from.

Tokens issued before this migration carry role=founder/employee and stop working
(get_current_user rejects a role claim that no longer matches the row), so
everyone signs in once more after deploy.

Revision ID: c3a7e1f2b9d4
Revises: b7c8d9e0f1a2
Create Date: 2026-10-02 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'c3a7e1f2b9d4'
down_revision: Union[str, None] = 'b7c8d9e0f1a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    ]


def upgrade() -> None:
    # --- roles -------------------------------------------------------------------
    op.execute("ALTER TYPE user_role RENAME VALUE 'founder' TO 'owner'")
    op.execute("ALTER TYPE user_role RENAME VALUE 'employee' TO 'member'")
    # ADD VALUE cannot be used in the transaction that adds it, and older Postgres
    # refuses it inside a transaction at all — so it gets its own.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'admin' AFTER 'owner'")
    op.alter_column('users', 'role', server_default='member')

    # --- org hierarchy -----------------------------------------------------------
    op.create_table(
        'departments',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('company_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('hue', sa.Integer(), nullable=True),
        sa.Column('head_employee_id', postgresql.UUID(as_uuid=True), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(['company_id'], ['companies.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['head_employee_id'], ['employees.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('company_id', 'name', name='uq_departments_company_name'),
    )
    op.create_index(op.f('ix_departments_company_id'), 'departments', ['company_id'])

    op.create_table(
        'teams',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('company_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('department_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('lead_employee_id', postgresql.UUID(as_uuid=True), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(['company_id'], ['companies.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['department_id'], ['departments.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['lead_employee_id'], ['employees.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('department_id', 'name', name='uq_teams_department_name'),
    )
    op.create_index(op.f('ix_teams_company_id'), 'teams', ['company_id'])
    op.create_index(op.f('ix_teams_department_id'), 'teams', ['department_id'])

    op.create_table(
        'team_memberships',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('company_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('team_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('employee_id', postgresql.UUID(as_uuid=True), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(['company_id'], ['companies.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['team_id'], ['teams.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['employee_id'], ['employees.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('team_id', 'employee_id', name='uq_team_memberships_team_employee'),
    )
    op.create_index(op.f('ix_team_memberships_company_id'), 'team_memberships', ['company_id'])
    op.create_index(op.f('ix_team_memberships_team_id'), 'team_memberships', ['team_id'])
    op.create_index(op.f('ix_team_memberships_employee_id'), 'team_memberships', ['employee_id'])

    op.create_table(
        'admin_assignments',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('company_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('department_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('team_id', postgresql.UUID(as_uuid=True), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(['company_id'], ['companies.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['department_id'], ['departments.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['team_id'], ['teams.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.CheckConstraint(
            '(department_id IS NULL) <> (team_id IS NULL)',
            name='ck_admin_assignments_exactly_one_target',
        ),
        sa.UniqueConstraint('user_id', 'department_id', name='uq_admin_assignments_user_department'),
        sa.UniqueConstraint('user_id', 'team_id', name='uq_admin_assignments_user_team'),
    )
    op.create_index(op.f('ix_admin_assignments_company_id'), 'admin_assignments', ['company_id'])
    op.create_index(op.f('ix_admin_assignments_user_id'), 'admin_assignments', ['user_id'])

    op.add_column(
        'employees',
        sa.Column('department_id', postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        'fk_employees_department_id', 'employees', 'departments',
        ['department_id'], ['id'], ondelete='SET NULL',
    )
    op.create_index(op.f('ix_employees_department_id'), 'employees', ['department_id'])


def downgrade() -> None:
    op.drop_index(op.f('ix_employees_department_id'), table_name='employees')
    op.drop_constraint('fk_employees_department_id', 'employees', type_='foreignkey')
    op.drop_column('employees', 'department_id')

    op.drop_index(op.f('ix_admin_assignments_user_id'), table_name='admin_assignments')
    op.drop_index(op.f('ix_admin_assignments_company_id'), table_name='admin_assignments')
    op.drop_table('admin_assignments')
    op.drop_index(op.f('ix_team_memberships_employee_id'), table_name='team_memberships')
    op.drop_index(op.f('ix_team_memberships_team_id'), table_name='team_memberships')
    op.drop_index(op.f('ix_team_memberships_company_id'), table_name='team_memberships')
    op.drop_table('team_memberships')
    op.drop_index(op.f('ix_teams_department_id'), table_name='teams')
    op.drop_index(op.f('ix_teams_company_id'), table_name='teams')
    op.drop_table('teams')
    op.drop_index(op.f('ix_departments_company_id'), table_name='departments')
    op.drop_table('departments')

    # Postgres cannot drop an enum value, so the type is rebuilt. Admins fold back
    # into employees — the closest the old two-role model has.
    op.alter_column('users', 'role', server_default=None)
    op.execute("ALTER TYPE user_role RENAME TO user_role_rbac")
    op.execute("CREATE TYPE user_role AS ENUM ('founder', 'employee')")
    op.execute(
        "ALTER TABLE users ALTER COLUMN role TYPE user_role USING ("
        "CASE role::text WHEN 'owner' THEN 'founder' ELSE 'employee' END"
        ")::user_role"
    )
    op.execute("DROP TYPE user_role_rbac")
    op.alter_column('users', 'role', server_default='employee')
