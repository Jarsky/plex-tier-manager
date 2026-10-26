import { Film, Link2, RefreshCw, Server, Unplug, UserPlus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, plexStartUrl } from "../../api";
import { Button, Card, errorText, Field, linkButton, Notice, Spinner, Toggle, useToast } from "../../ui";
import { SecretInput, useSettings } from "./common";

type Status = {
  connected: boolean; owner_username: string; server_id: string; server_name: string; callback_url: string;
  servers: { id: string; name: string }[]; libraries: { key: string; id: string; title: string; type: string }[];
  members?: { shared: number; invited: number; none: number };
};
type FriendRow = { plex_id: string; username: string; email: string | null; thumb: string | null; status: "shared" | "invited";
  user_id: string | null; plan: string | null; managed: boolean };

function Friends({ plans }: { plans: { id: string; name: string; price_cents: number }[] }) {
  const toast = useToast();
  const [rows, setRows] = useState<FriendRow[] | null>(null);
  const [planId, setPlanId] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<FriendRow[]>("/admin/plex/friends").then(setRows).catch((e) => { toast(errorText(e), "error"); setRows([]); }), [toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!planId && plans.length) setPlanId((plans.find((p) => p.price_cents === 0) ?? plans[0]).id); }, [plans, planId]);
  if (!rows) return <Card title="People on the server"><Spinner /></Card>;
  const waiting = rows.filter((r) => !r.plan).length;
  const run = async () => {
    const plan = plans.find((p) => p.id === planId)?.name;
    if (!confirm(`Give the ${plan} plan to ${waiting} people on the server who don't have a plan? From then on their access follows the plan.`)) return;
    setBusy(true);
    try { const r = await api<{ created: number; assigned: number }>("/admin/plex/import", { body: { plan_id: planId } });
      toast(`${r.assigned} given the ${plan} plan (${r.created} new accounts)`); load(); }
    catch (e) { toast(errorText(e), "error"); } finally { setBusy(false); }
  };
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-4 px-5 pb-4 pt-5 sm:px-6">
        <div><h2 className="text-base font-semibold text-white">People on the server</h2>
          <p className="mt-1 text-sm text-zinc-400">Existing friends keep their access untouched until you give them a plan. A free, hidden “Founding” plan works well for them.</p></div>
        {waiting > 0 && plans.length > 0 && (
          <div className="flex items-end gap-2">
            <Field label="Plan for existing friends"><select className="input" value={planId} onChange={(e) => setPlanId(e.target.value)}>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Button variant="primary" loading={busy} onClick={run}><UserPlus className="size-4" /> Give to {waiting}</Button>
          </div>
        )}
      </div>
      {!rows.length ? <p className="px-6 pb-6 text-sm text-zinc-500">Nobody else has access yet.</p> : (
        <ul className="divide-y divide-white/5 border-t border-white/5">
          {rows.map((f) => (
            <li key={f.plex_id} className="flex items-center gap-3 px-5 py-2.5 text-sm sm:px-6">
              {f.thumb ? <img src={f.thumb} alt="" className="size-7 rounded-full" /> : <span className="size-7 rounded-full bg-ink-700" />}
              <div className="min-w-0 flex-1"><p className="truncate text-zinc-100">{f.username}</p><p className="truncate text-xs text-zinc-500">{f.email}</p></div>
              <span className="text-xs text-zinc-500">{f.status === "invited" ? "Invite pending" : "Shared"}</span>
              {f.user_id ? <Link to={`/admin/users/${f.user_id}`} className="w-32 truncate text-right text-xs text-plex hover:underline">{f.plan ?? "Joined, no plan"}</Link>
                : <span className="w-32 text-right text-xs text-zinc-600">Not joined</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SeerrSettings() {
  const { settings, setSettings, save, saving } = useSettings();
  const toast = useToast();
  const [key, setKey] = useState("");
  if (!settings) return null;
  const set = (k: string) => (v: string) => setSettings({ ...settings, [k]: v.trim() });
  const test = async () => {
    try { const r = await api<{ version: string; trending: number }>("/admin/seerr/test", { method: "POST" }); toast(`Connected to Seerr ${r.version} (${r.trending} trending titles)`); }
    catch (e) { toast(errorText(e), "error"); }
  };
  return (
    <Card title="Seerr (home page rows)">
      <p className="mb-4 text-sm text-zinc-400">Members' home page shows <b>New on the server</b> (trending titles already in Plex, newest first) and
        <b> Coming soon</b> (requested titles that aren't out yet). Refreshed every 30 minutes.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Seerr URL" hint="As this site reaches it"><input className="input" value={settings.seerr_url} onChange={(e) => set("seerr_url")(e.target.value)} placeholder="http://mediabox.local.lan:5055" /></Field>
        <Field label="API key" hint="Seerr → Settings → General"><SecretInput isSet={settings.seerr_api_key} value={key} onChange={setKey} /></Field>
      </div>
      <div className="mt-5">
        <span className="label">Members' posters link to</span>
        <div className="grid gap-2 sm:grid-cols-3">
          {([["seerr", "Seerr", "Details, and requesting more."], ["plex", "Plex", "Straight to the title on the server. Titles not out yet link to Seerr."],
             ["none", "Nothing", "Posters only."]] as const).map(([k, label, text]) => (
            <button key={k} type="button" onClick={() => setSettings({ ...settings, title_links: k })}
              className={`rounded-xl border p-3 text-left ${settings.title_links === k ? "border-gold/60 bg-gold/10" : "border-white/10 hover:border-white/20"}`}>
              <p className="text-sm font-medium text-white">{label}</p><p className="mt-0.5 text-xs text-zinc-400">{text}</p></button>
          ))}
        </div>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Seerr public URL" hint="For Seerr links"><input className="input" value={settings.seerr_public_url} onChange={(e) => set("seerr_public_url")(e.target.value)} placeholder="https://seerr.example.com" /></Field>
        <Field label="Plex external URL" hint="For Plex links, e.g. https://plex.example.com. Blank = app.plex.tv"><input className="input" value={settings.plex_web_url} onChange={(e) => set("plex_web_url")(e.target.value)} placeholder="https://app.plex.tv" /></Field>
      </div>
      <div className="mt-5"><Toggle checked={settings.home_rows_public} onChange={(v) => setSettings({ ...settings, home_rows_public: v })}
        label="Show the rows on the public home page" hint="Visitors see the posters and titles, without links." /></div>
      <div className="mt-5 flex gap-2">
        <Button variant="primary" loading={saving} onClick={() => save({ seerr_url: settings.seerr_url, seerr_public_url: settings.seerr_public_url,
          title_links: settings.title_links, plex_web_url: settings.plex_web_url, home_rows_public: settings.home_rows_public,
          ...(key ? { seerr_api_key: key } : {}) }).then((ok) => ok && setKey(""))}>Save</Button>
        <Button onClick={test}>Test connection</Button>
      </div>
    </Card>
  );
}

export default function PlexPage() {
  const toast = useToast();
  const [s, setS] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [plans, setPlans] = useState<{ id: string; name: string; price_cents: number }[]>([]);
  const [busy, setBusy] = useState("");
  const load = useCallback(() => api<Status>("/admin/plex").then((x) => { setS(x); setError(""); }).catch((e) => setError(errorText(e))), []);
  useEffect(() => { load(); api<{ id: string; name: string; price_cents: number }[]>("/admin/plans").then(setPlans).catch(() => {}); }, [load]);
  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try { await fn(); toast(ok); await load(); } catch (e) { toast(errorText(e), "error"); } finally { setBusy(""); }
  };
  if (error && !s) return <Notice tone="error">{error}</Notice>;
  if (!s) return <Spinner />;

  return (
    <div className="space-y-6">
      <div><h2 className="text-2xl font-semibold text-white">Plex server</h2>
        <p className="mt-1 text-sm text-zinc-400">The server members are invited to. Access is checked against plans every 15 minutes, and straight away when a plan changes.</p></div>
      {error && <Notice tone="error">{error}</Notice>}

      <Card title="Server owner's Plex account">
        {!s.connected ? (
          <div className="space-y-4">
            <p className="text-sm text-zinc-400">Sign in with the Plex account that owns the server. Only its access token is kept (encrypted), to invite and
              remove members. Use the owner account, not your member account, if they differ.</p>
            <a href={plexStartUrl({ mode: "owner", returnTo: "/admin/plex" })} className={linkButton("plex")}><Link2 className="size-4" /> Connect Plex owner account</a>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-zinc-300">Connected as <b className="text-white">{s.owner_username}</b></p>
            <div className="flex gap-2">
              <a href={plexStartUrl({ mode: "owner", returnTo: "/admin/plex" })} className={linkButton("secondary")}>Reconnect</a>
              <Button variant="danger" loading={busy === "dc"} onClick={() => confirm("Disconnect? Members keep their access, but nothing is managed until you connect again.")
                && act("dc", () => api("/admin/plex/disconnect", { method: "POST" }), "Disconnected")}><Unplug className="size-4" /> Disconnect</Button>
            </div>
          </div>
        )}
      </Card>

      {s.connected && (
        <Card title="Server">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-60 flex-1"><Field label="Share this server">
              <select className="input" value={s.server_id} onChange={(e) => act("server", () => api("/admin/plex/server", { method: "PUT", body: { server_id: e.target.value } }), "Server saved")}>
                {!s.server_id && <option value="">Choose a server…</option>}
                {s.servers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select></Field></div>
            {s.server_id && <Button loading={busy === "check"} onClick={() => act("check", () => api("/admin/plex/check", { method: "POST" }), "Checked every member with Plex")}>
              <RefreshCw className="size-4" /> Check all members now</Button>}
          </div>
          {s.members && (
            <div className="mt-5 grid grid-cols-3 gap-3 text-center">
              {([["On the server", s.members.shared], ["Invited", s.members.invited], ["No access", s.members.none]] as const).map(([l, n]) => (
                <div key={l} className="rounded-xl border border-white/[0.06] bg-ink-850/60 py-3"><p className="text-2xl font-semibold tabular-nums text-white">{n}</p><p className="text-xs text-zinc-500">{l}</p></div>
              ))}
            </div>
          )}
        </Card>
      )}

      {s.server_id && (
        <Card title="Libraries">
          <ul className="grid gap-2 sm:grid-cols-2">
            {s.libraries.map((l) => <li key={l.key} className="flex items-center gap-2 rounded-lg border border-white/[0.06] px-3 py-2 text-sm text-zinc-200">
              {l.type === "movie" || l.type === "show" ? <Film className="size-4 text-gold" /> : <Server className="size-4 text-zinc-500" />}{l.title}
              <span className="ml-auto text-xs capitalize text-zinc-500">{l.type}</span></li>)}
          </ul>
          <p className="mt-3 text-xs text-zinc-500">Choose which libraries each plan shares under <Link to="/admin/billing" className="text-plex hover:underline">Plans & billing</Link>.</p>
        </Card>
      )}

      {s.server_id && <Friends plans={plans} />}
      <SeerrSettings />
    </div>
  );
}
