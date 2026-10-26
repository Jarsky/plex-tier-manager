import { Check, Copy, Plus, RefreshCw, Sparkles, Star, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, money, qualityText, streamsText, type BillingEventRow, type PlanLimits, type Promotion } from "../../api";
import { Button, Card, errorText, Field, formatDateTime, Notice, Spinner, Toggle, useToast } from "../../ui";
import { SecretInput, useSettings } from "./common";

type AdminPlan = {
  id: string; name: string; description: string; perks: string[]; price_cents: number; currency: string; interval: string;
  highlight: boolean; active: boolean; sort_order: number; members: number; purchasable: boolean; stripe_price_id: string | null;
  section_keys: string[] | null; limits: PlanLimits;
};
type Library = { key: string; title: string; type: string };

const EMPTY = { name: "", description: "", perks: "", price: "0", currency: "", interval: "month", active: true, highlight: false,
  sort_order: 0, section_keys: null as string[] | null, max_streams: "2", max_resolution: "1080", allow_downloads: false };
type Draft = typeof EMPTY;

const toDraft = (p: AdminPlan): Draft => ({
  name: p.name, description: p.description, perks: p.perks.join("\n"), price: (p.price_cents / 100).toString(), currency: p.currency,
  interval: p.interval, active: p.active, highlight: p.highlight, sort_order: p.sort_order, section_keys: p.section_keys,
  max_streams: p.limits.max_streams?.toString() ?? "", max_resolution: p.limits.max_resolution ?? "", allow_downloads: p.limits.allow_downloads,
});
const num = (v: string) => (v.trim() === "" ? null : Number(v));
const toBody = (d: Draft) => ({
  name: d.name, description: d.description, perks: d.perks.split("\n").map((x) => x.trim()).filter(Boolean),
  price_cents: Math.round(Number(d.price || 0) * 100), currency: d.currency, interval: d.interval, active: d.active,
  highlight: d.highlight, sort_order: d.sort_order, section_keys: d.section_keys, max_streams: num(d.max_streams),
  max_resolution: d.max_resolution || null, allow_downloads: d.allow_downloads,
});

function PlanEditor({ initial, libraries, onSave, onCancel, saving }: { initial: Draft; libraries: Library[];
  onSave: (d: Draft) => void; onCancel: () => void; saving: boolean }) {
  const [d, setD] = useState(initial);
  const set = <K extends keyof Draft>(k: K) => (v: Draft[K]) => setD({ ...d, [k]: v });
  return (
    <div className="space-y-5 rounded-xl border border-white/10 bg-ink-850/60 p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name"><input className="input" value={d.name} maxLength={60} onChange={(e) => set("name")(e.target.value)} placeholder="Standard" /></Field>
        <div className="grid grid-cols-[1fr_5rem_7rem] gap-2">
          <Field label="Price" hint="0 = free (admin gives it)"><input className="input" inputMode="decimal" value={d.price} onChange={(e) => set("price")(e.target.value.replace(/[^\d.]/g, ""))} /></Field>
          <Field label="Currency"><input className="input uppercase" maxLength={3} value={d.currency} onChange={(e) => set("currency")(e.target.value.toLowerCase())} placeholder="usd" /></Field>
          <Field label="Every"><select className="input" value={d.interval} onChange={(e) => set("interval")(e.target.value)}><option value="month">month</option><option value="year">year</option></select></Field>
        </div>
        <div className="sm:col-span-2"><Field label="Description"><input className="input" value={d.description} maxLength={500} onChange={(e) => set("description")(e.target.value)} placeholder="For couples and small households" /></Field></div>
        <div className="sm:col-span-2"><Field label="Extra selling points" hint="One per line, shown above the automatic list of limits.">
          <textarea className="input min-h-20" value={d.perks} onChange={(e) => set("perks")(e.target.value)} placeholder={"Request new movies\nPriority support"} /></Field></div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Streams at once" hint="Blank = no limit"><input className="input" inputMode="numeric" value={d.max_streams} onChange={(e) => set("max_streams")(e.target.value.replace(/\D/g, ""))} /></Field>
        <Field label="Highest quality" hint="Streams above it are stopped (Tautulli)">
          <select className="input" value={d.max_resolution} onChange={(e) => set("max_resolution")(e.target.value)}>
            <option value="480">480p (SD)</option><option value="720">720p</option><option value="1080">1080p</option><option value="4k">4K</option><option value="">No limit</option>
          </select></Field>
        <div className="pt-6"><Toggle checked={d.allow_downloads} onChange={set("allow_downloads")} label="Downloads" hint="Offline viewing in Plex apps" /></div>
      </div>
      <div>
        <span className="label">Libraries</span>
        <Toggle checked={d.section_keys === null} onChange={(v) => set("section_keys")(v ? null : libraries.map((l) => l.key))} label="Every library, including ones added later" />
        {d.section_keys !== null && (
          <div className="mt-3 flex flex-wrap gap-2">
            {libraries.map((l) => {
              const on = d.section_keys!.includes(l.key);
              return <button key={l.key} type="button" onClick={() => set("section_keys")(on ? d.section_keys!.filter((x) => x !== l.key) : [...d.section_keys!, l.key])}
                className={`rounded-full border px-3 py-1 text-xs ${on ? "border-gold/50 bg-gold/15 text-white" : "border-white/10 text-zinc-500"}`}>{l.title}</button>;
            })}
            {!libraries.length && <p className="text-xs text-zinc-500">Connect the Plex server to pick libraries.</p>}
          </div>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Toggle checked={d.active} onChange={set("active")} label="Offered" hint="Shown on the pricing page. Hide free plans you give out yourself." />
        <Toggle checked={d.highlight} onChange={set("highlight")} label="Highlight as “Most popular”" />
      </div>
      <div className="flex gap-2">
        <Button variant="primary" loading={saving} disabled={!d.name.trim() || (d.section_keys !== null && !d.section_keys.length)} onClick={() => onSave(d)}>Save plan</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function StripeSettings() {
  const { settings, setSettings, save, saving } = useSettings();
  const toast = useToast();
  const [key, setKey] = useState("");
  const [hook, setHook] = useState("");
  const [test, setTest] = useState<{ ok: boolean; text: string; url?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  if (!settings) return <Spinner />;
  const webhookUrl = `${window.location.origin}/api/billing/webhook`;
  const runTest = async () => {
    try { const r = await api<{ account: string; live: boolean; webhook_url: string }>("/admin/billing/test", { method: "POST" });
      setTest({ ok: true, text: `Connected to ${r.account} (${r.live ? "LIVE mode: real payments" : "test mode"})`, url: r.webhook_url }); }
    catch (e) { setTest({ ok: false, text: errorText(e) }); }
  };
  return (
    <Card title="Stripe">
      <div className="space-y-5">
        <Toggle checked={settings.billing_enabled} onChange={(v) => setSettings({ ...settings, billing_enabled: v })} label="Sell paid plans"
          hint="Shows the pricing page and lets members subscribe. Turn on once Stripe is connected and your plans are ready." />
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_6rem]">
          <Field label="Secret key" hint={<>Developers → API keys at <a className="text-plex" href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noreferrer">dashboard.stripe.com</a>. Use sk_test_… first.</>}>
            <SecretInput isSet={settings.stripe_secret_key} value={key} onChange={setKey} placeholder="sk_live_… or sk_test_…" /></Field>
          <Field label="Webhook signing secret" hint="From the webhook endpoint below (whsec_…).">
            <SecretInput isSet={settings.stripe_webhook_secret} value={hook} onChange={setHook} placeholder="whsec_…" /></Field>
          <Field label="Currency" hint="For new plans"><input className="input uppercase" maxLength={3} value={settings.billing_currency}
            onChange={(e) => setSettings({ ...settings, billing_currency: e.target.value.toLowerCase() })} /></Field>
        </div>
        <div className="rounded-xl border border-white/10 bg-ink-850 p-4 text-sm text-zinc-400">
          <p className="mb-2 text-zinc-200">Webhook setup (Developers → Webhooks → Add endpoint)</p>
          <div className="flex items-center gap-2 rounded-lg bg-ink-900 p-1.5 pl-3">
            <code className="min-w-0 flex-1 truncate text-gold">{webhookUrl}</code>
            <button type="button" onClick={async () => { await navigator.clipboard.writeText(webhookUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
              className="inline-flex items-center gap-1 rounded-md bg-ink-700 px-2.5 py-1 text-xs text-zinc-100">{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} Copy</button>
          </div>
          <p className="mt-2">Events: <code>checkout.session.completed</code>, <code>customer.subscription.created</code>, <code>customer.subscription.updated</code>, <code>customer.subscription.deleted</code>, <code>checkout.session.expired</code>.
            For the payments log also add <code>invoice.paid</code>, <code>invoice.payment_failed</code>, <code>charge.refunded</code>, <code>charge.dispute.created</code> and <code>charge.dispute.closed</code>.</p>
          <p className="mt-1">Also save your <a className="text-plex" href="https://dashboard.stripe.com/settings/billing/portal" target="_blank" rel="noreferrer">customer portal settings</a> once, and allow switching between your plans' products there.</p>
        </div>
        {test && <Notice tone={test.ok ? "success" : "error"}>{test.text}</Notice>}
        <div className="flex gap-2">
          <Button variant="primary" loading={saving} onClick={() => save({ billing_enabled: settings.billing_enabled, billing_currency: settings.billing_currency,
            ...(key ? { stripe_secret_key: key } : {}), ...(hook ? { stripe_webhook_secret: hook } : {}) }).then((ok) => { if (ok) { setKey(""); setHook(""); } })}>Save</Button>
          <Button onClick={runTest}>Test connection</Button>
          <Button variant="ghost" onClick={async () => {
            try { const r = await api<{ warnings: string[] }>("/admin/plans/resync", { method: "POST" }); toast(r.warnings.length ? r.warnings.join(" ") : "Plans synced to Stripe", r.warnings.length ? "error" : "success"); }
            catch (e) { toast(errorText(e), "error"); }
          }}><RefreshCw className="size-4" /> Sync plans & codes to Stripe</Button>
        </div>
      </div>
    </Card>
  );
}

export default function Billing() {
  const toast = useToast();
  const [plans, setPlans] = useState<AdminPlan[] | null>(null);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [editing, setEditing] = useState<string | null>(null);   // plan id, or "new"
  const [saving, setSaving] = useState(false);
  const load = useCallback(() => api<AdminPlan[]>("/admin/plans").then(setPlans).catch((e) => toast(errorText(e), "error")), [toast]);
  useEffect(() => {
    load();
    api<{ libraries: Library[] }>("/admin/plex").then((x) => setLibraries(x.libraries)).catch(() => {});
  }, [load]);
  if (!plans) return <Spinner />;

  const save = async (id: string, d: Draft) => {
    setSaving(true);
    try {
      const r = await api<{ warning: string | null }>(id === "new" ? "/admin/plans" : `/admin/plans/${id}`, { method: id === "new" ? "POST" : "PATCH", body: toBody(d) });
      toast(r.warning ?? "Plan saved", r.warning ? "error" : "success"); setEditing(null); load();
    } catch (e) { toast(errorText(e), "error"); } finally { setSaving(false); }
  };
  const remove = async (p: AdminPlan) => {
    if (!confirm(`Delete the ${p.name} plan?`)) return;
    try { await api(`/admin/plans/${p.id}`, { method: "DELETE" }); load(); } catch (e) { toast(errorText(e), "error"); }
  };

  return (
    <div className="space-y-6">
      <div><h2 className="text-2xl font-semibold text-white">Plans & billing</h2>
        <p className="mt-1 text-sm text-zinc-400">Each plan sets the libraries shared and the limits Tautulli enforces. Paid plans are created in Stripe for you when you save.
          Members without a plan have no server access.</p></div>
      <Card title="Plans" actions={editing !== "new" && <Button onClick={() => setEditing("new")}><Plus className="size-4" /> New plan</Button>}>
        <div className="space-y-3">
          {editing === "new" && <PlanEditor initial={EMPTY} libraries={libraries} saving={saving} onSave={(d) => save("new", d)} onCancel={() => setEditing(null)} />}
          {plans.map((p) => editing === p.id
            ? <PlanEditor key={p.id} initial={toDraft(p)} libraries={libraries} saving={saving} onSave={(d) => save(p.id, d)} onCancel={() => setEditing(null)} />
            : (
              <div key={p.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-white/10 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-zinc-100">{p.name}
                    {p.highlight && <Star className="size-3.5 fill-amber-300 text-amber-300" />}
                    {!p.active && <span className="rounded bg-ink-700 px-1.5 text-[10px] uppercase text-zinc-500">Hidden</span>}</p>
                  <p className="text-xs text-zinc-500">{p.price_cents ? `${money(p.price_cents, p.currency)} / ${p.interval}` : "Free"} · {p.members} member{p.members === 1 ? "" : "s"}
                    {` · ${streamsText(p.limits.max_streams).toLowerCase()} · ${qualityText(p.limits.max_resolution_label).toLowerCase()}`}
                    {p.price_cents > 0 && (p.stripe_price_id ? " · on Stripe" : " · not on Stripe yet")}</p>
                </div>
                <Button variant="ghost" onClick={() => setEditing(p.id)}>Edit</Button>
                <Button variant="ghost" onClick={() => remove(p)}><Trash2 className="size-4" /></Button>
              </div>
            ))}
          {!plans.length && editing !== "new" && <p className="text-sm text-zinc-500">No plans yet. Add your paid plans, plus a hidden free “Founding” plan for people already on the server.</p>}
        </div>
      </Card>
      <Promotions plans={plans} />
      <StripeSettings />
      <BillingEvents />
    </div>
  );
}

function BillingEvents() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; events: BillingEventRow[] } | null>(null);
  useEffect(() => { api(`/admin/billing/events?page=${page}`).then(setData).catch(() => setData({ total: 0, events: [] })); }, [page]);
  if (!data) return null;
  const pages = Math.max(1, Math.ceil(data.total / 50));
  return (
    <section className="card overflow-hidden">
      <div className="px-5 pb-3 pt-5 sm:px-6"><h2 className="text-base font-semibold text-white">Payments log</h2>
        <p className="mt-1 text-xs text-zinc-500">Every Stripe event received. Repeats of the same event are ignored, so nothing is applied twice.</p></div>
      {!data.events.length ? <p className="px-6 pb-6 text-sm text-zinc-500">No events yet.</p> : (
        <ul className="divide-y divide-white/5 border-t border-white/5">
          {data.events.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-sm sm:px-6">
              <span className={`min-w-0 flex-1 ${/failed|dispute/.test(e.type) ? "text-amber-200" : e.amount_cents && e.amount_cents < 0 ? "text-red-300" : "text-zinc-200"}`}>{e.summary}</span>
              {e.user_id ? <Link to={`/admin/users/${e.user_id}`} className="truncate text-xs text-plex hover:underline">{e.user_label || e.user_id}</Link>
                : <span className="font-mono text-xs text-zinc-500">{e.customer_id ?? "—"}</span>}
              <span className="shrink-0 text-xs text-zinc-500">{formatDateTime(e.stripe_created_at ?? e.received_at)}</span>
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

type AdminPromotion = Promotion & { code: string | null; starts_at: string | null; max_redemptions: number | null; redemptions: number;
  reserved: number; active: boolean; status: string; on_stripe: boolean; warning: string | null };

const PROMO_EMPTY = { name: "", code: "", plan_ids: null as string[] | null, trial_days: "", percent_off: "", duration: "once",
  duration_months: "", starts_at: "", ends_at: "", max_redemptions: "", first_subscription_only: true, active: true };
type PromoDraft = typeof PROMO_EMPTY;
const toLocal = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : "");
const promoDraft = (p: AdminPromotion): PromoDraft => ({
  name: p.name, code: p.code ?? "", plan_ids: p.plan_ids, trial_days: p.trial_days?.toString() ?? "", percent_off: p.percent_off?.toString() ?? "",
  duration: p.duration, duration_months: p.duration_months?.toString() ?? "", starts_at: toLocal(p.starts_at), ends_at: toLocal(p.ends_at),
  max_redemptions: p.max_redemptions?.toString() ?? "", first_subscription_only: p.first_subscription_only, active: p.active,
});
const promoBody = (d: PromoDraft) => ({
  name: d.name, code: d.code.trim() || null, plan_ids: d.plan_ids, trial_days: d.code.trim() ? null : num(d.trial_days), percent_off: num(d.percent_off),
  duration: d.duration, duration_months: d.duration === "repeating" ? num(d.duration_months) : null,
  starts_at: d.starts_at ? new Date(`${d.starts_at}T00:00:00`).toISOString() : null,
  ends_at: d.ends_at ? new Date(`${d.ends_at}T23:59:59`).toISOString() : null,
  max_redemptions: num(d.max_redemptions), first_subscription_only: d.first_subscription_only, active: d.active,
});

function PromotionEditor({ initial, plans, onSave, onCancel, saving }: { initial: PromoDraft; plans: AdminPlan[];
  onSave: (d: PromoDraft) => void; onCancel: () => void; saving: boolean }) {
  const [d, setD] = useState(initial);
  const set = <K extends keyof PromoDraft>(k: K) => (v: PromoDraft[K]) => setD({ ...d, [k]: v });
  const digits = (k: keyof PromoDraft) => (e: React.ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: e.target.value.replace(/\D/g, "") });
  const paid = plans.filter((p) => p.price_cents > 0);
  return (
    <div className="space-y-5 rounded-xl border border-white/10 bg-ink-850/60 p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" hint="Shown to customers, e.g. “Launch special”."><input className="input" value={d.name} maxLength={80} onChange={(e) => set("name")(e.target.value)} /></Field>
        <Field label="Code" hint="Typed on Stripe's payment page; discounts only. Leave blank to apply automatically to everyone who qualifies.">
          <input className="input font-mono uppercase" value={d.code} maxLength={40} onChange={(e) => set("code")(e.target.value.replace(/[^A-Za-z0-9_-]/g, "").toUpperCase())} placeholder="SUMMER25" /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Free trial (days)" hint={d.code ? "Not possible with a code" : undefined}>
          <input className="input" inputMode="numeric" value={d.code ? "" : d.trial_days} onChange={digits("trial_days")} placeholder="e.g. 30" disabled={!!d.code} /></Field>
        <Field label="% off"><input className="input" inputMode="numeric" value={d.percent_off} onChange={digits("percent_off")} placeholder="e.g. 50" /></Field>
        <Field label="Discount lasts"><select className="input" value={d.duration} onChange={(e) => set("duration")(e.target.value)} disabled={!d.percent_off}>
          <option value="once">First payment</option><option value="repeating">Some months</option><option value="forever">Forever</option></select></Field>
        {d.duration === "repeating" && d.percent_off
          ? <Field label="Months"><input className="input" inputMode="numeric" value={d.duration_months} onChange={digits("duration_months")} /></Field> : <div />}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Starts" hint="Blank = now"><input className="input" type="date" value={d.starts_at} onChange={(e) => set("starts_at")(e.target.value)} /></Field>
        <Field label="Ends" hint="Blank = no end date"><input className="input" type="date" value={d.ends_at} onChange={(e) => set("ends_at")(e.target.value)} /></Field>
        <Field label="Max uses" hint="Blank = unlimited"><input className="input" inputMode="numeric" value={d.max_redemptions} onChange={digits("max_redemptions")} /></Field>
      </div>
      <div>
        <Toggle checked={d.plan_ids === null} onChange={(v) => set("plan_ids")(v ? null : paid.map((p) => p.id))} label="All paid plans" />
        {d.plan_ids !== null && (
          <div className="mt-3 flex flex-wrap gap-2">
            {paid.map((p) => {
              const on = d.plan_ids!.includes(p.id);
              return <button key={p.id} type="button" onClick={() => set("plan_ids")(on ? d.plan_ids!.filter((x) => x !== p.id) : [...d.plan_ids!, p.id])}
                className={`rounded-full border px-3 py-1 text-xs ${on ? "border-gold/50 bg-gold/15 text-white" : "border-white/10 text-zinc-500"}`}>{p.name}</button>;
            })}
          </div>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Toggle checked={d.first_subscription_only} onChange={set("first_subscription_only")} label="First subscription only"
          hint="People who have subscribed before can't use it." />
        <Toggle checked={d.active} onChange={set("active")} label="Active" hint="Turn off to pause it." />
      </div>
      <div className="flex gap-2">
        <Button variant="primary" loading={saving} disabled={!d.name.trim() || (d.code ? !d.percent_off : !d.trial_days && !d.percent_off)} onClick={() => onSave(d)}>Save promotion</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function Promotions({ plans }: { plans: AdminPlan[] }) {
  const toast = useToast();
  const [rows, setRows] = useState<AdminPromotion[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(() => api<AdminPromotion[]>("/admin/promotions").then(setRows).catch((e) => toast(errorText(e), "error")), [toast]);
  useEffect(() => { load(); }, [load]);
  if (!rows) return null;
  const planNames = (ids: string[] | null) => (ids ? ids.map((id) => plans.find((p) => p.id === id)?.name ?? "deleted plan").join(", ") : "all paid plans");
  const save = async (id: string, d: PromoDraft) => {
    setSaving(true);
    try {
      const r = await api<AdminPromotion>(id === "new" ? "/admin/promotions" : `/admin/promotions/${id}`, { method: id === "new" ? "POST" : "PATCH", body: promoBody(d) });
      toast(r.warning ?? (r.code ? `Saved. ${r.code} works on Stripe's payment page.` : "Promotion saved"), r.warning ? "error" : "success"); setEditing(null); load();
    } catch (e) { toast(errorText(e), "error"); } finally { setSaving(false); }
  };
  const remove = async (p: AdminPromotion) => {
    if (!confirm(`Delete “${p.name}”? People already subscribed keep their discount.`)) return;
    try { await api(`/admin/promotions/${p.id}`, { method: "DELETE" }); load(); } catch (e) { toast(errorText(e), "error"); }
  };
  return (
    <Card title="Promotions" actions={editing !== "new" && <Button onClick={() => setEditing("new")}><Plus className="size-4" /> New promotion</Button>}>
      <p className="-mt-1 mb-4 text-sm text-zinc-400">Automatic promotions (free trials and discounts) show on the pricing page and apply at checkout.
        Code promotions become Stripe promotion codes that customers type on Stripe's payment page; Stripe enforces their limits.
        Stripe hides its code box when an automatic discount already applies. Changing a discount doesn't affect people already using it.</p>
      <div className="space-y-3">
        {editing === "new" && <PromotionEditor initial={PROMO_EMPTY} plans={plans} saving={saving} onSave={(d) => save("new", d)} onCancel={() => setEditing(null)} />}
        {rows.map((p) => editing === p.id
          ? <PromotionEditor key={p.id} initial={promoDraft(p)} plans={plans} saving={saving} onSave={(d) => save(p.id, d)} onCancel={() => setEditing(null)} />
          : (
            <div key={p.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-white/10 px-4 py-3">
              <Sparkles className={`size-5 shrink-0 ${p.status === "Running" ? "text-gold" : "text-zinc-600"}`} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-zinc-100">{p.name}
                  {p.code ? <><code className="rounded bg-ink-700 px-1.5 text-xs text-gold">{p.code}</code>
                    {!p.on_stripe && <span className="rounded bg-amber-400/15 px-1.5 text-[10px] uppercase text-amber-200" title="Save it again or use “Sync plans & codes to Stripe”">Not on Stripe</span>}</>
                    : <span className="rounded bg-ink-700 px-1.5 text-[10px] uppercase text-zinc-300">Automatic</span>}
                  {p.status !== "Running" && <span className="rounded bg-ink-700 px-1.5 text-[10px] uppercase text-zinc-500">{p.status}</span>}</p>
                <p className="text-xs text-zinc-500">{p.summary} · {planNames(p.plan_ids)} · used {p.redemptions}{p.max_redemptions ? ` of ${p.max_redemptions}` : ""}{p.reserved ? ` (+${p.reserved} in checkout)` : ""}
                  {p.ends_at ? ` · ends ${formatDateTime(p.ends_at)}` : ""}</p>
              </div>
              <Button variant="ghost" onClick={() => setEditing(p.id)}>Edit</Button>
              <Button variant="ghost" onClick={() => remove(p)}><Trash2 className="size-4" /></Button>
            </div>
          ))}
        {!rows.length && editing !== "new" && <p className="text-sm text-zinc-500">No promotions yet.</p>}
      </div>
    </Card>
  );
}
