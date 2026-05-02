"""Add user audit fields

Revision ID: add_user_audit_fields
Revises: 09860bcf4cc6
Create Date: 2025-07-02 21:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'add_user_audit_fields'
down_revision = '09860bcf4cc6'
branch_labels = None
depends_on = None

def upgrade():
    with op.batch_alter_table('user', schema=None) as batch_op:
        batch_op.add_column(sa.Column('last_modified', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('last_password_set', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('last_login', sa.DateTime(), nullable=True))

def downgrade():
    with op.batch_alter_table('user', schema=None) as batch_op:
        batch_op.drop_column('last_modified')
        batch_op.drop_column('last_password_set')
        batch_op.drop_column('last_login') 