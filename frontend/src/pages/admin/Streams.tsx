import { Check, Copy, Square } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type EnforcementRow } from "../../api";
import { Button, Card, errorText, Field, formatDateTime, Notice, Spinner, useToast } from "../../ui";
import { SecretInput, useSettings } from "./common";

type Live = { mode: string; sessions: { session_id: string; session_key: string; title: string; username: string; user_id: string | null;
  plan: string | null; max_streams: number | null; max_resolution: string | null; resolution: string | null; decision: string | null;
  player: string | null; platform: string | null; state: string | null; progress: string | null; media_type: string | null; owner: boolean;
  breach: { rule: string; detail: string } | null }[] };
type TautulliStatus = { url: string; api_key_set: boolean; mode: string; webhook_url: string };

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg bg-ink-900 p-1.5 pl-3">
      <code className="min-w-0 flex-1 truncate text-gold">{value}</code>
      <button type="button" onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        className="inline-flex items-center gap-1 rounded-md bg-ink-700 px-2.5 py-1 text-xs text-zinc-100">{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} Copy</button>
    </div>
  );
}

const MODES: [string, string, string][] = [
  ["off", "Off", "Nothing is checked."],
  ["monitor", "Monitor", "Streams over a plan's limits are logged below, but keep playing. Use this first to check your plans."],
  ["enforce", "Enforce", "Streams over a plan's limits are stopped, with the message below shown in the player."],
];

function Setup({ onSaved }: { onSaved: () => void }) {
  const { settings, setSettings, save, saving } = useSettings();
  const toast = useToast();
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<TautulliStatus | null>(null);
  useEffect(() => { api<TautulliStatus>("/admin/tautulli").then(setStatus).catch(() => {}); }, []);
  if (!settings) return <Spinner />;
  const set = (k: string) => (v: any) => setSettings({ ...settings, [k]: v });
  const test = async () => {
    try { const r = await api<{ server: string; version: string }>("/admin/tautulli/test", { method: "POST" }); toast(`Connected: Tautulli sees ${r.server} ${r.version ?? ""}`); }
    catch (e) { toast(errorText(e), "error"); }
  };
  return (
    <Card title="Tautulli">
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tautulli URL" hint="As this site's server reaches it, e.g. http://tautulli:8181"><input className="input" value={settings.tautulli_url} onChange={(e) => set("tautulli_url")(e.target.value.trim())} placeholder="http://tautulli:8181" /></Field>
          <Field label="API key" hint="Tautulli → Settings → Web Interface → API key"><SecretInput isSet={settings.tautulli_api_key} value={key} onChange={setKey} /></Field>
        </div>
        <div>
          <span className="label">Stream limits</span>
          <div className="grid gap-2 sm:grid-cols-3">
            {MODES.map(([k, label, text]) => (
              <button key={k} type="button" onClick={() => set("enforcement_mode")(k)}
                className={`rounded-xl border p-3 text-left ${settings.enforcement_mode === k ? "border-gold/60 bg-gold/10" : "border-white/10 hover:border-white/20"}`}>
                <p className="text-sm font-medium text-white">{label}</p><p className="mt-0.5 text-xs text-zinc-400">{text}</p></button>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Message: too many streams" hint="{plan} and {limit} are filled in."><textarea className="input min-h-20" value={settings.stream_limit_message} onChange={(e) => set("stream_limit_message")(e.target.value)} /></Field>
          <Field label="Message: quality too high" hint="{plan} and {quality} are filled in."><textarea className="input min-h-20" value={settings.quality_limit_message} onChange={(e) => set("quality_limit_message")(e.target.value)} /></Field>
        </div>
        {status && (
          <div className="rounded-xl border border-white/10 bg-ink-850 p-4 text-sm text-zinc-400">
            <p className="mb-2 text-zinc-200">Webhook (so limits apply the moment playback starts)</p>
            <CopyField value={status.webhook_url} />
            <p className="mt-2">In Tautulli: Settings → Notification Agents → Add → <b>Webhook</b>. Paste the URL above, method <b>POST</b>. Under Triggers tick
              <b> Playback Start</b>, <b>Playback Resume</b> and <b>Transcode Decision Change</b>. The content of the message doesn't matter. Without the webhook,
              a check still runs every minute.</p>
          </div>
        )}
        <div className="flex gap-2">
          <Button variant="primary" loading={saving} onClick={() => save({
            tautulli_url: settings.tautulli_url, enforcement_mode: settings.enforcement_mode, stream_limit_message: settings.stream_limit_message,
            quality_limit_message: settings.quality_limit_message, ...(key ? { tautulli_api_key: key } : {}),
          }).then((ok) => { if (ok) { setKey(""); onSaved(); } })}>Save</Button>
          <Button onClick={test}>Test connection</Button>
        </div>
      </div>
    </Card>
  );
}

function LiveStreams({ tick }: { tick: number }) {
  const toast = useToast();
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => api<Live>("/admin/tautulli/activity").then((x) => { setLive(x); setError(""); }).catch((e) => setError(errorText(e))), []);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load, tick]);
  const stop = async (id: string, who: string) => {
    if (!confirm(`Stop ${who}'s stream?`)) return;
    try { await api("/admin/tautulli/stop", { body: { session_id: id } }); toast("Stream stopped"); setTimeout(load, 1500); } catch (e) { toast(errorText(e), "error"); }
  };
  return (
    <section className="card overflow-hidden">
      <div className="px-5 pb-3 pt-5 sm:px-6"><h2 className="text-base font-semibold text-white">Playing now</h2>
        <p className="mt-1 text-xs text-zinc-500">Refreshes every 15 seconds.{live?.mode === "monitor" && " Monitor mode: streams marked over a limit are only logged."}</p></div>
      {error ? <div className="px-6 pb-6"><Notice tone="error">{error}</Notice></div>
        : !live ? <Spinner /> : !live.sessions.length ? <p className="px-6 pb-6 text-sm text-zinc-500">Nothing is playing.</p> : (
        <ul className="divide-y divide-white/5 border-t border-white/5">
          {live.sessions.map((x) => (
            <li key={x.session_id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm sm:px-6">
              <div className="min-w-0 flex-1">
                <p className="truncate text-zinc-100">{x.title}</p>
                <p className="truncate text-xs text-zinc-500">
                  {x.user_id ? <Link to={`/admin/users/${x.user_id}`} className="text-plex hover:underline">{x.username}</Link> : x.username}
                  {x.owner ? " · owner" : x.plan ? ` · ${x.plan}` : " · no plan"} · {x.player ?? x.platform} · {x.resolution ?? "?"} {x.decision ?? ""} · {x.state}</p>
              </div>
              {x.breach && <span className="rounded bg-red-500/15 px-2 py-0.5 text-xs text-red-300">{x.breach.detail}</span>}
              <Button className="!px-2.5 !py-1.5" onClick={() => stop(x.session_id, x.username)}><Square className="size-3.5" /> Stop</Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Log() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; events: EnforcementRow[] } | null>(null);
  useEffect(() => { api(`/admin/enforcement/events?page=${page}`).then(setData).catch(() => setData({ total: 0, events: [] })); }, [page]);
  if (!data) return null;
  const pages = Math.max(1, Math.ceil(data.total / 50));
  const tone = { stopped: "text-red-300", logged: "text-zinc-400", failed: "text-amber-200" };
  return (
    <section className="card overflow-hidden">
      <div className="px-5 pb-3 pt-5 sm:px-6"><h2 className="text-base font-semibold text-white">Over-limit streams</h2></div>
      {!data.events.length ? <p className="px-6 pb-6 text-sm text-zinc-500">None yet.</p> : (
        <ul className="divide-y divide-white/5 border-t border-white/5">
          {data.events.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-sm sm:px-6">
              <span className="min-w-0 flex-1 truncate text-zinc-200">{e.user_id ? <Link to={`/admin/users/${e.user_id}`} className="text-plex hover:underline">{e.plex_username}</Link> : e.plex_username}
                <span className="text-zinc-500"> · {e.title}</span></span>
              <span className="text-xs text-zinc-400">{e.detail}</span>
              <span className={`w-16 text-xs capitalize ${tone[e.action]}`}>{e.action}</span>
              <span className="text-xs text-zinc-500">{formatDateTime(e.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
      {pages > 1 && <div className="flex items-center justify-center gap-3 border-t border-white/5 p-3 text-sm">
        <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span className="text-zinc-400">Page {page} of {pages}</span>
        <Button disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button></div>}
    </section>
  );
}

export default function Streams() {
  const [tick, setTick] = useState(0);
  return (
    <div className="space-y-6">
      <div><h2 className="text-2xl font-semibold text-white">Streams</h2>
        <p className="mt-1 text-sm text-zinc-400">Tautulli reports what's playing; each plan's stream count and quality limits are checked against it. Admins and the owner are never limited.</p></div>
      <Setup onSaved={() => setTick((t) => t + 1)} />
      <LiveStreams tick={tick} />
      <Log />
    </div>
  );
}
