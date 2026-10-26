import { ArrowLeft, ExternalLink, LogOut, Monitor, Shield, Smartphone } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type AuditEntry, type BillingEventRow, type EnforcementRow, type PlexMemberInfo } from "../../api";
import { Button, Card, errorText, formatDate, formatDateTime, Notice, Spinner, timeAgo, useToast } from "../../ui";
import { describeAgent } from "../Account";
import { AuditRow } from "./Audit";
import { AccessBadge, UserEditor, type AdminUser } from "./Users";

type Detail = {
  id: string; display_name: string; email: string | null; avatar_url: string | null; is_admin: boolean; is_disabled: boolean;
  created_at: string; last_login_at: string | null; plex: PlexMemberInfo | null; is_owner: boolean;
  membership: { plan: string | null; plan_id: string | null; plan_source: string | null; status: string | null; period_end: string | null;
    cancel_at_period_end: boolean; lapsed: boolean; stripe_customer_id: string | null; stripe_subscription_id: string | null; stripe_url: string | null };
  sessions: { created_at: string; last_seen_at: string; expires_at: string; ip: string; user_agent: string }[];
  enforcement: EnforcementRow[];
  activity: AuditEntry[];
  payments: BillingEventRow[];
  support: { id: string; number: number; subject: string; status: string; updated_at: string }[];
};

// A card whose rows run edge to edge, with a padded title.
function ListCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="card overflow-hidden"><h2 className="px-5 pb-3 pt-5 text-base font-semibold text-white sm:px-6">{title}</h2>{children}</section>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex justify-between gap-3 py-1.5 text-sm"><span className="text-zinc-500">{label}</span><span className="text-right text-zinc-200">{children}</span></div>;
}

export default function UserDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [u, setU] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [plans, setPlans] = useState<{ id: string; name: string }[]>([]);
  const load = useCallback(() => api<Detail>(`/admin/users/${id}`).then(setU).catch((e) => {
    if (e.status === 404) nav("/admin/users", { replace: true });   // e.g. just deleted
    else setError(errorText(e));
  }), [id, nav]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api<{ id: string; name: string }[]>("/admin/plans").then(setPlans).catch(() => {}); }, []);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!u) return <Spinner />;

  const m = u.membership;
  const editable: AdminUser = {
    id: u.id, display_name: u.display_name, email: u.email, avatar_url: u.avatar_url, is_admin: u.is_admin, is_disabled: u.is_disabled,
    created_at: u.created_at, last_login_at: u.last_login_at, plan_id: m.plan_id, plan: m.plan, plan_source: m.plan_source,
    subscription_status: m.status, plex: u.plex,
  };
  const p = u.plex;
  const signOut = async () => {
    try { const r = await api<{ sessions: number }>(`/admin/users/${u.id}/sign-out`, { body: {} }); toast(`Ended ${r.sessions} session(s)`); load(); }
    catch (e) { toast(errorText(e), "error"); }
  };

  return (
    <div className="space-y-6">
      <Link to="/admin/users" className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white"><ArrowLeft className="size-4" /> All members</Link>
      <div className="flex flex-wrap items-center gap-4">
        {u.avatar_url ? <img src={u.avatar_url} alt="" className="size-14 rounded-full object-cover" />
          : <span className="grid size-14 place-items-center rounded-full bg-gradient-brand text-xl font-bold text-ink-950">{u.display_name.slice(0, 1).toUpperCase()}</span>}
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-2xl font-semibold text-white">{u.display_name}
            {u.is_admin && <Shield className="size-4 text-ember" aria-label="Admin" />}
            {u.is_disabled && <span className="rounded bg-red-500/20 px-1.5 text-xs uppercase text-red-300">Disabled</span>}</h2>
          <p className="text-sm text-zinc-400">{p ? `@${p.username} · ` : ""}{u.email ?? "No email"} · joined {formatDate(u.created_at)}
            {u.last_login_at && ` · last sign-in ${timeAgo(u.last_login_at)}`}</p>
          <p className="font-mono text-xs text-zinc-600">{u.id}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Plex & server access">
          {!p ? <p className="text-sm text-zinc-500">No Plex account linked.</p> : u.is_owner ? <p className="text-sm text-zinc-400">The server owner.</p> : (
            <div className="divide-y divide-white/5">
              <Row label="Status"><AccessBadge plex={p} /></Row>
              <Row label="Managed by this site">{p.managed ? "Yes" : p.existing_friend ? "No (existing access, no plan yet)" : "No"}</Row>
              <Row label="Downloads">{p.allow_downloads ? "Allowed" : "Off"}</Row>
              {p.invited_at && <Row label="Invited">{formatDateTime(p.invited_at)}</Row>}
              {p.shared_at && <Row label="On the server since">{formatDate(p.shared_at)}</Row>}
              {p.removed_at && <Row label="Removed">{formatDateTime(p.removed_at)}</Row>}
              <Row label="Last checked">{p.checked_at ? timeAgo(p.checked_at) : "Never"}</Row>
              <Row label="Plex account id"><span className="font-mono text-xs">{p.plex_id}</span></Row>
            </div>
          )}
          {p?.last_error && <div className="mt-3"><Notice tone={p.last_error.startsWith("Warning") ? "warn" : "error"}>
            {p.last_error.startsWith("Warning") ? p.last_error.replace(/^Warning: /, "") : `Last Plex error: ${p.last_error}`}</Notice></div>}
        </Card>
        <Card title="Membership" actions={m.stripe_url && <a href={m.stripe_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-plex hover:underline">Stripe <ExternalLink className="size-3.5" /></a>}>
          <p className="text-lg font-semibold text-white">{m.plan ?? "No plan"}</p>
          <p className="text-sm text-zinc-400">{m.plan_source === "stripe" ? `Paid · ${m.status}${m.period_end ? ` · ${m.cancel_at_period_end ? "ends" : "renews"} ${formatDate(m.period_end)}` : ""}`
            : m.plan_source === "admin" ? "Given by an admin" : m.status ? `Subscription ${m.status}` : "No subscription"}</p>
          {m.stripe_customer_id && <p className="mt-2 font-mono text-xs text-zinc-600">{m.stripe_customer_id}{m.stripe_subscription_id && ` · ${m.stripe_subscription_id}`}</p>}
          {m.status === "past_due" && <div className="mt-3"><Notice tone="warn">Their last payment failed; Stripe is retrying.</Notice></div>}
          {m.lapsed && <div className="mt-3"><Notice tone="warn">The paid period ended more than 3 days ago without word from Stripe, so they're treated as having no plan.</Notice></div>}
        </Card>
        <Card title="Active sessions" actions={u.sessions.length > 0 && <Button className="!py-1.5" onClick={signOut}><LogOut className="size-4" /> Sign out everywhere</Button>}>
          {!u.sessions.length ? <p className="text-sm text-zinc-500">Not signed in anywhere.</p> : (
            <ul className="divide-y divide-white/5">
              {u.sessions.map((s, i) => {
                const a = describeAgent(s.user_agent);
                const Icon = a.mobile ? Smartphone : Monitor;
                return <li key={i} className="flex items-center gap-3 py-2"><Icon className="size-4 shrink-0 text-zinc-500" />
                  <div className="min-w-0"><p className="text-sm text-zinc-200">{a.label}</p>
                    <p className="truncate text-xs text-zinc-500">{s.ip} · since {formatDate(s.created_at)} · active {timeAgo(s.last_seen_at)}</p></div></li>;
              })}
            </ul>
          )}
        </Card>
      </div>

      <ListCard title="Admin & plan"><UserEditor u={editable} plans={plans} onChanged={load} detailPage /></ListCard>

      {u.payments.length > 0 && (
        <ListCard title="Payments & billing events">
          <ul className="divide-y divide-white/5">
            {u.payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className={p.type.includes("failed") || p.type.includes("dispute") ? "text-amber-200" : "text-zinc-200"}>{p.summary}</span>
                <span className="shrink-0 text-xs text-zinc-500">{formatDateTime(p.stripe_created_at ?? p.received_at)}</span>
              </li>
            ))}
          </ul>
        </ListCard>
      )}

      {u.support.length > 0 && (
        <ListCard title="Support requests">
          <ul className="divide-y divide-white/5">
            {u.support.map((t) => (
              <li key={t.id}><Link to={`/admin/support/${t.id}`} className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-white/[0.03] sm:px-6">
                <span className="font-mono text-xs text-zinc-500">#{t.number}</span><span className="min-w-0 flex-1 truncate text-zinc-200">{t.subject}</span>
                <span className="text-xs capitalize text-zinc-500">{t.status} · {timeAgo(t.updated_at)}</span></Link></li>
            ))}
          </ul>
        </ListCard>
      )}

      {u.enforcement.length > 0 && (
        <ListCard title="Streams over plan limits">
          <ul className="divide-y divide-white/5">
            {u.enforcement.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm sm:px-6">
                <div className="min-w-0"><p className="truncate text-zinc-200">{e.title}</p><p className="text-xs text-zinc-500">{e.detail}</p></div>
                <span className="shrink-0 text-xs text-zinc-500">{e.action} · {formatDateTime(e.created_at)}</span>
              </li>
            ))}
          </ul>
        </ListCard>
      )}

      <ListCard title="Activity">
        {!u.activity.length ? <p className="p-5 text-sm text-zinc-500">Nothing recorded yet.</p>
          : <ul className="divide-y divide-white/5">{u.activity.map((e) => <AuditRow key={e.id} e={e} />)}</ul>}
      </ListCard>
    </div>
  );
}
