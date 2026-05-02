from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
from flask_login import UserMixin

db = SQLAlchemy()

class User(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=True)
    plex_id = db.Column(db.String(120), unique=True, nullable=True)
    username = db.Column(db.String(80), nullable=True)
    role = db.Column(db.Integer, default=2)  # 0=admin, 1=power, 2=standard user
    password_hash = db.Column(db.String(128), nullable=True)  # Only for email users
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    active = db.Column(db.Boolean, default=True)  # New field for enable/disable
    subscriptions = db.relationship('Subscription', backref='user', lazy=True)
    last_modified = db.Column(db.DateTime, nullable=True)
    last_password_set = db.Column(db.DateTime, nullable=True)
    last_login = db.Column(db.DateTime, nullable=True)

class Subscription(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    tier = db.Column(db.String(50), nullable=False)
    active = db.Column(db.Boolean, default=True)
    start_date = db.Column(db.DateTime, default=datetime.utcnow)
    end_date = db.Column(db.DateTime, nullable=True)
    stripe_subscription_id = db.Column(db.String(120), nullable=True)
    payment_status = db.Column(db.String(50), nullable=True)  # e.g., paid, pending, failed
    last_payment_date = db.Column(db.DateTime, nullable=True)
    renewal = db.Column(db.Boolean, default=True)  # auto-renewal flag
    notes = db.Column(db.Text, nullable=True)  # admin notes or special cases

    def as_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'tier': self.tier,
            'active': self.active,
            'start_date': self.start_date,
            'end_date': self.end_date,
            'stripe_subscription_id': self.stripe_subscription_id,
            'payment_status': self.payment_status,
            'last_payment_date': self.last_payment_date,
            'renewal': self.renewal,
            'notes': self.notes
        }

class SiteSettings(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(100), unique=True, nullable=False)
    value = db.Column(db.Text, nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    @staticmethod
    def get_setting(key, default=None):
        setting = SiteSettings.query.filter_by(key=key).first()
        return setting.value if setting else default
    
    @staticmethod
    def set_setting(key, value):
        setting = SiteSettings.query.filter_by(key=key).first()
        if setting:
            setting.value = value
        else:
            setting = SiteSettings(key=key, value=value)
            db.session.add(setting)
        db.session.commit()
        return setting

class AuditLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    admin_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    action = db.Column(db.String(255), nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    details = db.Column(db.Text, nullable=True)
    object_type = db.Column(db.String(50), nullable=True)  # e.g., 'Subscription', 'User'
    object_id = db.Column(db.Integer, nullable=True)

    @staticmethod
    def log_action(admin_id, action, details=None, object_type=None, object_id=None):
        log = AuditLog(
            admin_id=admin_id,
            action=action,
            details=details,
            object_type=object_type,
            object_id=object_id
        )
        db.session.add(log)
        db.session.commit()

    @staticmethod
    def filter_logs(query=None, object_type=None, admin_id=None, start_date=None, end_date=None):
        q = AuditLog.query
        if query:
            q = q.filter(AuditLog.details.ilike(f"%{query}%"))
        if object_type:
            q = q.filter_by(object_type=object_type)
        if admin_id:
            q = q.filter_by(admin_id=admin_id)
        if start_date:
            q = q.filter(AuditLog.timestamp >= start_date)
        if end_date:
            q = q.filter(AuditLog.timestamp <= end_date)
        return q.order_by(AuditLog.timestamp.desc()).all() 