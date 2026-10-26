import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base, utcnow


def new_id() -> str:
    return uuid.uuid4().hex


class User(Base):
    """A member. Everyone signs in with Plex; the Plex side lives in PlexMember."""

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    display_name: Mapped[str] = mapped_column(String(120), default="")
    email: Mapped[str | None] = mapped_column(String(320), index=True)   # from Plex; for contact, not for signing in
    avatar_url: Mapped[str | None] = mapped_column(String(1024))
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    is_disabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # Membership: NULL plan = no server access. plan_source: "stripe" (kept in sync by webhooks) or "admin"
    plan_id: Mapped[str | None] = mapped_column(ForeignKey("plans.id", ondelete="SET NULL"), index=True)
    plan_source: Mapped[str | None] = mapped_column(String(10))
    stripe_customer_id: Mapped[str | None] = mapped_column(String(64), unique=True)
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(64), index=True)
    subscription_status: Mapped[str | None] = mapped_column(String(24))   # Stripe status: active, past_due, canceled…
    subscription_period_end: Mapped[datetime | None] = mapped_column()
    subscription_cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column()

    plex: Mapped["PlexMember | None"] = relationship(back_populates="user", cascade="all, delete-orphan", passive_deletes=True, uselist=False)


class PlexMember(Base):
    """A member's Plex account and their access to the server.

    share_status is what Plex last reported: none, invited (waiting for them to accept) or shared.
    managed means this app granted or took over that access, so it may also take it away; access that existed
    before (existing_friend) is left alone until an admin gives the member a plan.
    """

    __tablename__ = "plex_members"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    plex_id: Mapped[str] = mapped_column(String(32), unique=True)        # Plex account id
    uuid: Mapped[str] = mapped_column(String(64), default="")
    username: Mapped[str] = mapped_column(String(255), default="")
    email: Mapped[str | None] = mapped_column(String(320))
    thumb: Mapped[str | None] = mapped_column(String(1024))
    share_status: Mapped[str] = mapped_column(String(10), default="none")
    managed: Mapped[bool] = mapped_column(Boolean, default=False)
    existing_friend: Mapped[bool] = mapped_column(Boolean, default=False)
    shared_section_keys: Mapped[list[str] | None] = mapped_column(JSON)  # libraries last shared by us
    allow_downloads: Mapped[bool] = mapped_column(Boolean, default=False)
    invited_at: Mapped[datetime | None] = mapped_column()
    shared_at: Mapped[datetime | None] = mapped_column()
    removed_at: Mapped[datetime | None] = mapped_column()
    checked_at: Mapped[datetime | None] = mapped_column()
    last_error: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    user: Mapped[User] = relationship(back_populates="plex")


class Session(Base):
    __tablename__ = "sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    expires_at: Mapped[datetime] = mapped_column()
    last_seen_at: Mapped[datetime] = mapped_column(default=utcnow)
    user_agent: Mapped[str] = mapped_column(String(512), default="")
    ip: Mapped[str] = mapped_column(String(64), default="")


class Setting(Base):
    """Admin-editable site settings. Secret values are stored encrypted (see settings_store)."""

    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)


class Plan(Base):
    """A membership level: which libraries are shared and the limits Tautulli enforces. Price 0 = free (admin-assigned)."""

    __tablename__ = "plans"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(60))
    description: Mapped[str] = mapped_column(Text, default="")
    perks: Mapped[list[str]] = mapped_column(JSON, default=list)          # bullet points on the pricing page
    price_cents: Mapped[int] = mapped_column(Integer, default=0)
    currency: Mapped[str] = mapped_column(String(3), default="usd")
    interval: Mapped[str] = mapped_column(String(5), default="month")    # month | year
    active: Mapped[bool] = mapped_column(Boolean, default=True)          # offered on the pricing page
    highlight: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    section_keys: Mapped[list[str] | None] = mapped_column(JSON)         # Plex library keys shared; NULL = every library
    max_streams: Mapped[int | None] = mapped_column(Integer)             # at once; NULL = no limit
    max_resolution: Mapped[str | None] = mapped_column(String(8))        # 480 | 720 | 1080 | 4k; NULL = no limit
    allow_downloads: Mapped[bool] = mapped_column(Boolean, default=False)
    stripe_product_id: Mapped[str | None] = mapped_column(String(64))
    stripe_price_id: Mapped[str | None] = mapped_column(String(64), index=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class Promotion(Base):
    """A free trial and/or a percentage off paid plans at checkout: automatic (no code) or for people who enter the code."""

    __tablename__ = "promotions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(80))                          # shown on the pricing page, e.g. "Launch special"
    code: Mapped[str | None] = mapped_column(String(40), unique=True)      # upper case; NULL = applies automatically
    plan_ids: Mapped[list[str] | None] = mapped_column(JSON)               # NULL = every paid plan
    trial_days: Mapped[int | None] = mapped_column(Integer)
    percent_off: Mapped[int | None] = mapped_column(Integer)
    duration: Mapped[str] = mapped_column(String(10), default="once")      # once | repeating | forever (Stripe coupon terms)
    duration_months: Mapped[int | None] = mapped_column(Integer)           # for "repeating"
    starts_at: Mapped[datetime | None] = mapped_column()
    ends_at: Mapped[datetime | None] = mapped_column()
    max_redemptions: Mapped[int | None] = mapped_column(Integer)
    redemptions: Mapped[int] = mapped_column(Integer, default=0)         # completed checkouts
    reserved: Mapped[int] = mapped_column(Integer, default=0)            # checkouts started and still open
    first_subscription_only: Mapped[bool] = mapped_column(Boolean, default=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    stripe_coupon_id: Mapped[str | None] = mapped_column(String(64))       # made at first use; cleared when the terms change
    stripe_promotion_code_id: Mapped[str | None] = mapped_column(String(64))   # code promotions: the code customers type at Stripe
    stripe_code_active: Mapped[bool] = mapped_column(Boolean, default=False)   # what Stripe was last told
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class AuditLog(Base):
    """Who did what: admin changes, sign-ins, account and billing events. Kept after the actor or target is deleted."""

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    actor_id: Mapped[str | None] = mapped_column(String(32), index=True)    # NULL = system, Stripe or an anonymous visitor
    actor_label: Mapped[str] = mapped_column(String(320), default="")
    action: Mapped[str] = mapped_column(String(60), index=True)            # e.g. "admin.user.update", "auth.login"
    target_type: Mapped[str | None] = mapped_column(String(30))
    target_id: Mapped[str | None] = mapped_column(String(64), index=True)
    target_label: Mapped[str] = mapped_column(String(320), default="")
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    ip: Mapped[str] = mapped_column(String(64), default="")


class BillingEvent(Base):
    """Every Stripe webhook event received, by Stripe's event id (so retries are only applied once)."""

    __tablename__ = "billing_events"

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    type: Mapped[str] = mapped_column(String(80), index=True)
    user_id: Mapped[str | None] = mapped_column(String(32), index=True)
    customer_id: Mapped[str | None] = mapped_column(String(64))
    summary: Mapped[str] = mapped_column(String(500), default="")
    amount_cents: Mapped[int | None] = mapped_column(Integer)
    currency: Mapped[str | None] = mapped_column(String(3))
    stripe_created_at: Mapped[datetime | None] = mapped_column()
    received_at: Mapped[datetime] = mapped_column(default=utcnow, index=True)


class SupportTicket(Base):
    """A question or problem sent from the support page. `messages` is the conversation, oldest first."""

    __tablename__ = "support_tickets"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    number: Mapped[int] = mapped_column(Integer, unique=True)                # short reference shown to people, e.g. #1042
    user_id: Mapped[str | None] = mapped_column(String(32), index=True)    # NULL when sent while signed out; kept if the account goes
    name: Mapped[str] = mapped_column(String(120), default="")
    email: Mapped[str] = mapped_column(String(320))
    category: Mapped[str] = mapped_column(String(20))                      # access | playback | billing | account | request | other
    subject: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20), default="open", index=True)   # open | waiting (on the user) | closed
    messages: Mapped[list] = mapped_column(JSON, default=list)             # [{from: "user"|"admin", body, at, author}]
    context: Mapped[dict] = mapped_column(JSON, default=dict)              # page, user agent, ip at submission
    created_at: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)


class EnforcementEvent(Base):
    """A stream Tautulli reported over a member's plan limit, and whether it was stopped."""

    __tablename__ = "enforcement_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    user_id: Mapped[str | None] = mapped_column(String(32), index=True)
    plex_username: Mapped[str] = mapped_column(String(255), default="")
    rule: Mapped[str] = mapped_column(String(10))                          # streams | quality
    session_key: Mapped[str] = mapped_column(String(64), default="")
    title: Mapped[str] = mapped_column(String(500), default="")
    detail: Mapped[str] = mapped_column(String(500), default="")           # e.g. "3 streams, plan allows 2"
    action: Mapped[str] = mapped_column(String(12))                        # stopped | logged | failed
