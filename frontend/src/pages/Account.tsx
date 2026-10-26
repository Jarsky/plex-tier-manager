import { CreditCard, Download, LogOut, Monitor, Smartphone, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, money } from "../api";
import { useSession } from "../session";
import { Button, Card, errorText, formatDate, linkButton, timeAgo, useToast } from "../ui";
import { openBillingPortal } from "./Pricing";

function Billing() {
  const { me } = useSession();
  const toast = useToast();
  if (!me) return null;
  const m = me.membership;
  const live = ["active", "trialing", "past_due"].includes(m.status ?? "") && m.source === "stripe";
  return (
    <Card title="Plan & billing" actions={<Link to="/pricing" className="text-sm text-plex hover:underline">Compare plans</Link>}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-lg font-semibold text-white">{m.plan?.name ?? "No plan"}
            {m.plan && m.plan.price_cents > 0 && <span className="ml-2 text-sm font-normal text-zinc-400">{money(m.plan.price_cents, m.plan.currency)} / {m.plan.interval}</span>}</p>
          <p className="text-sm text-zinc-400">
            {m.status === "past_due" ? "Your last payment failed. Update your card to keep your access."
              : live && m.period_end ? `${m.cancel_at_period_end ? "Ends" : "Renews"} ${formatDate(m.period_end)}`
              : m.source === "admin" ? "Given by the server admin" : "Choose a plan to get onto the server"}
          </p>
        </div>
        <div className="flex gap-2">
          {m.has_billing_account && <Button onClick={() => openBillingPortal(toast)}><CreditCard className="size-4" /> Manage billing</Button>}
          {!m.plan && <Link to="/pricing" className={linkButton("primary")}>See plans</Link>}
        </div>
      </div>
    </Card>
  );
}

type Device = { id: string; current: boolean; created_at: string; last_seen_at: string; ip: string; user_agent: string };

// "Chrome on Windows" from a user agent; good enough to recognise your own devices.
export function describeAgent(ua: string) {
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows"
    : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return { label: os ? `${browser} on ${os}` : browser, mobile: /iPhone|Android|Mobile/.test(ua) };
}

function Devices() {
  const toast = useToast();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api<Device[]>("/me/sessions").then(setDevices).catch(() => setDevices([]));
  useEffect(() => { load(); }, []);
  if (!devices) return null;
  const others = devices.filter((d) => !d.current).length;
  return (
    <Card title="Signed-in devices" actions={others > 0 && <Button loading={busy} className="!py-1.5" onClick={async () => {
      setBusy(true);
      try { const r = await api<{ sessions: number }>("/me/sessions/sign-out-others", { body: {} }); toast(`Signed out ${r.sessions} other device(s)`); load(); }
      catch (e) { toast(errorText(e), "error"); } finally { setBusy(false); }
    }}><LogOut className="size-4" /> Sign out others</Button>}>
      <ul className="divide-y divide-white/5">
        {devices.map((d) => {
          const a = describeAgent(d.user_agent);
          const Icon = a.mobile ? Smartphone : Monitor;
          return (
            <li key={d.id} className="flex items-center gap-3 py-2.5">
              <Icon className="size-5 shrink-0 text-zinc-500" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-zinc-100">{a.label} {d.current && <span className="ml-1 rounded bg-gold/15 px-1.5 text-[10px] uppercase text-gold">This device</span>}</p>
                <p className="truncate text-xs text-zinc-500">{[d.ip, `signed in ${formatDate(d.created_at)}`, `active ${timeAgo(d.last_seen_at)}`].filter(Boolean).join(" · ")}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-zinc-500">Don't recognise one? Sign out the others, and change your Plex password on plex.tv.</p>
    </Card>
  );
}

async function downloadExport(toast: ReturnType<typeof useToast>) {
  try {
    const res = await fetch("/api/me/export", { credentials: "same-origin" });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "account-export.json";
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) { toast(errorText(e), "error"); }
}

export default function Account() {
  const { me, refresh } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const [name, setName] = useState(me?.display_name ?? "");
  const [busy, setBusy] = useState("");
  if (!me) return null;
  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try { await fn(); await refresh(); if (ok) toast(ok); } catch (e) { toast(errorText(e), "error"); } finally { setBusy(""); }
  };
  const paying = me.membership.status && ["active", "trialing", "past_due"].includes(me.membership.status);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white">Account</h1>
        <p className="mt-1 text-zinc-400">Member since {formatDate(me.created_at)}</p>
      </div>

      <Card title="Profile">
        <form className="flex gap-3" onSubmit={(e) => { e.preventDefault(); run("name", () => api("/me", { method: "PATCH", body: { display_name: name } }), "Saved"); }}>
          <input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          <Button loading={busy === "name"} disabled={!name.trim() || name === me.display_name}>Save</Button>
        </form>
      </Card>

      <Card title="Plex account">
        <div className="flex items-center gap-3">
          {me.plex?.thumb ? <img src={me.plex.thumb} alt="" className="size-11 rounded-full object-cover" />
            : <span className="grid size-11 place-items-center rounded-full bg-ink-800 text-zinc-400">{me.display_name.slice(0, 1)}</span>}
          <div>
            <p className="text-zinc-100">{me.plex?.username}</p>
            <p className="text-sm text-zinc-500">{me.plex?.email ?? me.email}</p>
          </div>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-zinc-500">You sign in with this Plex account, and it's the one invited to the server.
          To change your email or password, do it on plex.tv; it updates here the next time you sign in.</p>
      </Card>

      <Billing />
      <Devices />

      <Card title="Your data">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-zinc-400">Download everything stored about your account (profile, plan, server access, sign-in activity) as a JSON file.</p>
          <Button className="shrink-0" onClick={() => downloadExport(toast)}><Download className="size-4" /> Download my data</Button>
        </div>
      </Card>

      <Card title="Delete account">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-zinc-400">Deletes your account here{paying ? ", cancels your subscription straight away" : ""} and removes your
            access to the server. Your Plex account itself isn't affected.</p>
          <Button variant="danger" loading={busy === "del"} onClick={() => {
            if (confirm("Delete your account and lose access to the server? This can't be undone."))
              run("del", async () => { await api("/me", { method: "DELETE" }); nav("/"); });
          }}><Trash2 className="size-4" /> Delete</Button>
        </div>
      </Card>
    </div>
  );
}
