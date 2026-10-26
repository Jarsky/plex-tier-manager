// Thin fetch wrapper: JSON in/out, cookie session, CSRF header, readable errors.
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      credentials: "same-origin",
      headers: { "X-Requested-With": "ptm", ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    // A reverse proxy guarding /admin (e.g. Authentik forward auth) redirects expired sessions to its login page,
    // which fetch can't follow cross-origin. Reload the page so the browser does the login.
    if (path.startsWith("/admin")) { window.location.assign(window.location.pathname); }
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0);
  }
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const detail = data?.detail;
    const msg = typeof detail === "string" ? detail
      : Array.isArray(detail) ? detail.map((d: any) => d.msg).join("; ")
      : res.status === 502 || res.status === 504 ? "The server took too long or is unavailable. Try again."
      : `Request failed (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

function safeJson(t: string) { try { return JSON.parse(t); } catch { return null; } }

export const plexStartUrl = (opts: { mode?: "login" | "owner"; returnTo?: string } = {}) => {
  const q = new URLSearchParams({ mode: opts.mode ?? "login" });
  if (opts.returnTo) q.set("return_to", opts.returnTo);
  return `/api/auth/plex/start?${q}`;
};

// ── types ────────────────────────────────────────────────────────────────────
export type SiteConfig = {
  site_name: string; site_tagline: string; signup_open: boolean; plex_ready: boolean; server_name: string;
  plex_callback_url: string; support_enabled: boolean; billing_enabled: boolean; signed_in: boolean;
};

export type ServerAccess = "none" | "invited" | "shared";
export type PlanLimits = { max_streams: number | null; max_resolution: string | null; max_resolution_label: string | null;
  allow_downloads: boolean; all_libraries: boolean };

export type Me = {
  id: string; display_name: string; email: string | null; avatar_url: string | null; is_admin: boolean; created_at: string;
  plex: null | { username: string; email: string | null; thumb: string | null; server_access: ServerAccess; managed: boolean;
    existing_friend: boolean; invited_at: string | null; shared_at: string | null; is_owner: boolean };
  server_name: string;
  membership: Membership;
};

export type Membership = {
  plan: null | ({ id: string; name: string; price_cents: number; currency: string; interval: string; libraries: number } & PlanLimits);
  status: string | null; period_end: string | null; cancel_at_period_end: boolean; source: string | null; has_billing_account: boolean;
};

export type Plan = {
  id: string; name: string; description: string; perks: string[]; price_cents: number; currency: string; interval: string;
  highlight: boolean; purchasable: boolean; limits: PlanLimits; libraries: string[]; promotion: Promotion | null;
};

export type Promotion = {
  id: string; name: string; summary: string; trial_days: number | null; percent_off: number | null;
  duration: "once" | "repeating" | "forever"; duration_months: number | null; ends_at: string | null;
  first_subscription_only: boolean; plan_ids: string[] | null; has_code: boolean;
};

export const money = (cents: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);

export const streamsText = (n: number | null) => (n == null ? "Unlimited streams" : n === 1 ? "1 stream at a time" : `${n} streams at a time`);
export const qualityText = (label: string | null) => (label ? `Up to ${label}` : "Any quality, up to 4K");

// ── home page rows (from Seerr) ──────────────────────────────────────────────
export type Title = { tmdb_id: number; type: "movie" | "tv"; title: string; poster: string | null; release_date: string | null;
  next_air_date: string | null; status: number; requested: boolean; url: string | null; date?: string };
export type HomeRows = { enabled: boolean; new: Title[]; upcoming: Title[]; errors: Record<string, string> };

// ── admin: Plex & Tautulli ───────────────────────────────────────────────────
export type PlexMemberInfo = { plex_id: string; username: string; email: string | null; thumb: string | null; server_access: ServerAccess;
  managed: boolean; existing_friend: boolean; allow_downloads: boolean; invited_at: string | null; shared_at: string | null;
  removed_at: string | null; checked_at: string | null; last_error: string | null };
export type EnforcementRow = { id: number; created_at: string; user_id: string | null; plex_username: string; rule: "streams" | "quality";
  title: string; detail: string; action: "stopped" | "logged" | "failed" };

// ── audit ────────────────────────────────────────────────────────────────────
export type AuditEntry = { id: number; created_at: string; actor_id: string | null; actor_label: string; action: string;
  target_type: string | null; target_id: string | null; target_label: string; details: Record<string, any>; ip: string };
export type BillingEventRow = { id: string; type: string; user_id: string | null; user_label?: string; customer_id: string | null;
  summary: string; amount_cents: number | null; currency: string | null; stripe_created_at: string | null; received_at: string };

// ── support ──────────────────────────────────────────────────────────────────
export type SupportMessage = { from: "user" | "admin"; body: string; at: string; author: string };
export type SupportTicket = { id: string; number: number; category: string; subject: string; status: "open" | "waiting" | "closed";
  created_at: string; updated_at: string; messages: SupportMessage[] };
export const SUPPORT_CATEGORIES: Record<string, string> = {
  access: "Getting onto the server", playback: "Playback & streams", billing: "Billing & plans",
  account: "Account & sign-in", request: "Requests & ideas", other: "Something else",
};
