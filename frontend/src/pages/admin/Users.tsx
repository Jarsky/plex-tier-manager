import { ChevronDown, RefreshCw, Search, Shield, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type PlexMemberInfo, type ServerAccess } from "../../api";
import { useSession } from "../../session";
import { Button, Card, errorText, Field, formatDate, linkButton, Spinner, Toggle, useToast } from "../../ui";

export type AdminUser = {
  id: string; display_name: string; email: string | null; avatar_url: string | null; is_admin: boolean; is_disabled: boolean;
  created_at: string; last_login_at: string | null; plan_id: string | null; plan: string | null; plan_source: string | null;
  subscription_status: string | null; plex: PlexMemberInfo | null;
};

const ACCESS: Record<ServerAccess, [string, string]> = {
  shared: ["On the server", "bg-gold/15 text-gold"],
  invited: ["Invited", "bg-plex/15 text-plex"],
  none: ["No access", "bg-white/5 text-zinc-500"],
};

export function AccessBadge({ plex }: { plex: PlexMemberInfo | null }) {
  if (!plex) return null;
  const [label, cls] = ACCESS[plex.server_access] ?? ACCESS.none;
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${cls}`}>{label}</span>
      {plex.existing_friend && !plex.managed && <span className="rounded bg-ember/15 px-1.5 py-0.5 text-[10px] font-medium uppercase text-ember" title="Was on the server before joining; not managed until given a plan">Existing</span>}
      {plex.last_error && (plex.last_error.startsWith("Warning")
        ? <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-medium uppercase text-amber-200" title={plex.last_error}>Plex warning</span>
        : <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase text-red-300" title={plex.last_error}>Plex error</span>)}
    </span>
  );
}

export function UserEditor({ u, plans, onChanged, detailPage }: { u: AdminUser; plans: { id: string; name: string }[];
  onChanged: () => void; detailPage?: boolean }) {
  const { me } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const self = me?.id === u.id;
  const paying = u.plan_source === "stripe" && ["active", "trialing", "past_due"].includes(u.subscription_status ?? "");
  const patch = async (body: object, ok = "Saved") => {
    setBusy("patch");
    try {
      const r = await api<{ plex: string | null }>(`/admin/users/${u.id}`, { method: "PATCH", body });
      toast(r.plex && r.plex !== "ok" && r.plex !== "skipped" ? `${ok} · Plex: ${r.plex}` : ok); onChanged();
    } catch (e) { toast(errorText(e), "error"); } finally { setBusy(""); }
  };
  const check = async () => {
    setBusy("check");
    try { const r = await api<{ result: string }>(`/admin/users/${u.id}/plex-sync`, { method: "POST" }); toast(`Plex: ${r.result}`); onChanged(); }
    catch (e) { toast(errorText(e), "error"); } finally { setBusy(""); }
  };
  return (
    <div className="space-y-5 border-t border-white/5 bg-ink-850/50 px-4 py-5">
      <div className="flex flex-wrap gap-6">
        <Toggle checked={u.is_admin} disabled={self} onChange={(v) => patch({ is_admin: v })} label="Admin" />
        <Toggle checked={u.is_disabled} disabled={self} onChange={(v) => patch({ is_disabled: v })} label="Disabled"
          hint="Signs them out, blocks sign-in, and removes server access their plan gave." />
      </div>
      <Field label="Plan" hint={paying ? `Paid through Stripe (${u.subscription_status}). Change or cancel it in Stripe.`
        : "Giving a plan here (e.g. a free Founding plan) invites them; removing it takes their server access away."}>
        <select className="input" value={u.plan_id ?? ""} disabled={paying || busy !== ""} onChange={(e) => patch({ plan_id: e.target.value }, "Plan updated")}>
          <option value="">No plan (no server access)</option>
          {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
      <div className="flex flex-wrap justify-between gap-3">
        <div className="flex gap-2">
          {u.plex && <Button loading={busy === "check"} onClick={check}><RefreshCw className="size-4" /> Check with Plex now</Button>}
          {!detailPage && <Link to={`/admin/users/${u.id}`} className={linkButton("secondary")}>Details & activity</Link>}
        </div>
        {!self && <Button variant="danger" onClick={async () => {
          if (!confirm(`Delete ${u.display_name}'s account? Their server access is removed${paying ? " and their Stripe subscription is cancelled immediately" : ""}.`)) return;
          try { await api(`/admin/users/${u.id}`, { method: "DELETE" }); toast("Member deleted"); onChanged(); } catch (e) { toast(errorText(e), "error"); }
        }}><Trash2 className="size-4" /> Delete member</Button>}
      </div>
    </div>
  );
}

const FILTERS: [string, string][] = [["", "Everyone"], ["shared", "On the server"], ["invited", "Invited"], ["none", "No access"], ["unmanaged", "Existing, no plan"]];

export default function UsersPage() {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [access, setAccess] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; users: AdminUser[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [plans, setPlans] = useState<{ id: string; name: string }[]>([]);
  const load = () => api(`/admin/users?${new URLSearchParams({ q, access, page: String(page) })}`).then(setData).catch((e) => toast(errorText(e), "error"));
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [q, access, page]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api<{ id: string; name: string }[]>("/admin/plans").then(setPlans).catch(() => {}); }, []);
  const pages = data ? Math.max(1, Math.ceil(data.total / 50)) : 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h2 className="text-2xl font-semibold text-white">Members</h2><p className="mt-1 text-sm text-zinc-400">{data ? `${data.total.toLocaleString()} accounts` : ""}</p></div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
          <input className="input !pl-9" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Name, email or Plex username" />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map(([k, label]) => <button key={k} onClick={() => { setAccess(k); setPage(1); }}
          className={`rounded-full border px-3 py-1 text-xs ${access === k ? "border-gold/50 bg-gold/15 text-white" : "border-white/10 text-zinc-400 hover:text-white"}`}>{label}</button>)}
      </div>
      {!data ? <Spinner /> : (
        <Card className="overflow-hidden !p-0">
          <ul className="divide-y divide-white/5">
            {data.users.map((u) => (
              <li key={u.id}>
                <button onClick={() => setOpen(open === u.id ? null : u.id)} className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-white/[0.03]">
                  {u.avatar_url ? <img src={u.avatar_url} alt="" className="size-8 shrink-0 rounded-full object-cover" />
                    : <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ink-700 text-xs text-zinc-300">{u.display_name.slice(0, 1)}</span>}
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm text-zinc-100">
                      <span className="truncate">{u.display_name}</span>
                      {u.is_admin && <Shield className="size-3.5 text-ember" aria-label="Admin" />}
                      {u.is_disabled && <span className="rounded bg-red-500/20 px-1.5 text-[10px] uppercase text-red-300">Disabled</span>}
                      <AccessBadge plex={u.plex} />
                    </p>
                    <p className="truncate text-xs text-zinc-500">{[u.plex?.username && `@${u.plex.username}`, u.email].filter(Boolean).join(" · ")}</p>
                  </div>
                  <div className="hidden text-right text-xs text-zinc-500 sm:block">
                    <p>{u.plan ?? "No plan"}{u.plan_source === "stripe" && u.subscription_status ? ` · ${u.subscription_status}` : u.plan_source === "admin" ? " · admin" : ""}</p>
                    <p>Joined {formatDate(u.created_at)}{u.last_login_at ? ` · seen ${formatDate(u.last_login_at)}` : ""}</p>
                  </div>
                  <ChevronDown className={`size-4 text-zinc-500 transition ${open === u.id ? "rotate-180" : ""}`} />
                </button>
                {open === u.id && <UserEditor u={u} plans={plans} onChanged={load} />}
              </li>
            ))}
          </ul>
          {!data.users.length && <p className="p-6 text-sm text-zinc-500">No members found.</p>}
        </Card>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="text-zinc-400">Page {page} of {pages}</span>
          <Button disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
