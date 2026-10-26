import { CheckCircle2, Clock, CreditCard, Download, ExternalLink, Film, Gauge, Mail, MonitorPlay, RefreshCw, Server } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, money, qualityText, streamsText } from "../api";
import { useSession } from "../session";
import { Button, Card, errorText, formatDate, linkButton, Notice, useToast } from "../ui";
import { openBillingPortal } from "./Pricing";
import TitleRows from "./TitleRows";

const PLEX_APP = "https://app.plex.tv/desktop";

function Step({ n, done, title, children }: { n: number; done?: boolean; title: string; children?: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${done ? "bg-gold text-ink-950" : "border border-white/15 text-zinc-400"}`}>
        {done ? <CheckCircle2 className="size-4" /> : n}</span>
      <div className="pt-0.5"><p className={done ? "text-zinc-400 line-through decoration-zinc-600" : "text-zinc-100"}>{title}</p>
        {children && <div className="mt-1 text-sm text-zinc-400">{children}</div>}</div>
    </li>
  );
}

function Access() {
  const { me, config, refresh } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!me) return null;
  const server = me.server_name || config?.server_name || "the server";
  const access = me.plex?.server_access ?? "none";
  const plan = me.membership.plan;
  const recheck = async () => {
    setBusy(true);
    try {
      const r = await api<{ server_access: string }>("/me/check-access", { method: "POST" });
      await refresh();
      toast(r.server_access === "shared" ? "You're in. Enjoy!" : "Plex doesn't show the invite as accepted yet. Give it a minute and try again.",
        r.server_access === "shared" ? "success" : "error");
    } catch (e) { toast(errorText(e), "error"); } finally { setBusy(false); }
  };

  if (me.plex?.is_owner) return <Card title="Server access"><p className="text-sm text-zinc-400">You own {server}. Plans and limits don't apply to you.</p></Card>;
  if (access === "shared") return (
    <Card title="Server access">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-full bg-gold/15 text-gold"><Server className="size-5" /></span>
          <div><p className="font-medium text-white">You have access to {server}</p>
            <p className="text-sm text-zinc-400">{plan ? `On the ${plan.name} plan` : "Your existing access. The server admin will move you onto a plan."}</p></div>
        </div>
        <a href={PLEX_APP} target="_blank" rel="noreferrer" className={linkButton("plex")}>Open Plex <ExternalLink className="size-4" /></a>
      </div>
    </Card>
  );
  if (!plan) return (
    <Card title="Server access">
      <ol className="space-y-4">
        <Step n={1} done title="Sign in with Plex" />
        <Step n={2} title="Choose a plan">Plans set how many screens you can watch on at once and the quality.</Step>
        <Step n={3} title={`Accept the invite to ${server}`}>We send it as soon as your plan starts.</Step>
      </ol>
      <Link to="/pricing" className={linkButton("primary", "mt-6")}>See plans</Link>
    </Card>
  );
  return (
    <Card title="Server access">
      <ol className="space-y-4">
        <Step n={1} done title="Sign in with Plex" />
        <Step n={2} done title={`Choose a plan: ${plan.name}`} />
        <Step n={3} title={access === "invited" ? `Accept the invite to ${server}` : "Sending your invite…"}>
          {access === "invited" ? <>Plex emailed {me.plex?.email ?? "you"} an invite. Open it, or open Plex and accept it from your notifications. Then come back here.</>
            : <>This usually takes a few seconds. If it doesn't arrive within the hour, <Link to="/support" className="text-plex hover:underline">let us know</Link>.</>}
        </Step>
      </ol>
      <div className="mt-6 flex flex-wrap gap-2">
        <a href={PLEX_APP} target="_blank" rel="noreferrer" className={linkButton("plex")}><Mail className="size-4" /> Open Plex</a>
        <Button loading={busy} onClick={recheck}><RefreshCw className="size-4" /> I've accepted it</Button>
      </div>
    </Card>
  );
}

function Fact({ icon: Icon, label, value }: { icon: typeof Film; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-ink-850/60 px-4 py-3">
      <Icon className="size-5 shrink-0 text-gold" />
      <div><p className="text-xs uppercase tracking-wider text-zinc-500">{label}</p><p className="text-sm text-zinc-100">{value}</p></div>
    </div>
  );
}

function PlanSummary() {
  const { me, config } = useSession();
  const toast = useToast();
  if (!me?.membership.plan) return null;
  const m = me.membership;
  const p = m.plan!;
  const live = ["active", "trialing", "past_due"].includes(m.status ?? "") && m.source === "stripe";
  return (
    <Card title="Your plan" actions={config?.billing_enabled && <Link to="/pricing" className="text-sm text-plex hover:underline">Compare plans</Link>}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-2xl font-semibold text-white">{p.name}
          {p.price_cents > 0 && <span className="ml-2 text-sm font-normal text-zinc-400">{money(p.price_cents, p.currency)} / {p.interval}</span>}</p>
        <p className="flex items-center gap-1.5 text-sm text-zinc-400"><Clock className="size-4" />
          {m.status === "past_due" ? "Payment failed: update your card" : m.status === "trialing" && m.period_end ? `Free trial until ${formatDate(m.period_end)}`
            : live && m.period_end ? `${m.cancel_at_period_end ? "Ends" : "Renews"} ${formatDate(m.period_end)}` : m.source === "admin" ? "Given by the server admin" : ""}</p>
      </div>
      {m.status === "past_due" && <div className="mt-3"><Notice tone="warn">Your last payment didn't go through. Update your card under Manage billing to keep your access.</Notice></div>}
      {m.cancel_at_period_end && m.period_end && <div className="mt-3"><Notice>Your plan is cancelled. You keep access until {formatDate(m.period_end)}, then it's removed from the server.</Notice></div>}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Fact icon={MonitorPlay} label="Streams" value={streamsText(p.max_streams)} />
        <Fact icon={Gauge} label="Quality" value={qualityText(p.max_resolution_label)} />
        <Fact icon={Film} label="Libraries" value={p.all_libraries ? "Everything on the server" : `${p.libraries} ${p.libraries === 1 ? "library" : "libraries"}`} />
        <Fact icon={Download} label="Downloads" value={p.allow_downloads ? "Allowed" : "Not included"} />
      </div>
      {(p.max_streams != null || p.max_resolution) && <p className="mt-4 text-xs leading-relaxed text-zinc-500">
        Going over your plan stops the stream with a message in your player: the newest stream if too many are playing,
        or a stream above your plan's quality (choose a lower quality in the player's settings to keep watching).</p>}
      {m.has_billing_account && <Button className="mt-5" onClick={() => openBillingPortal(toast)}><CreditCard className="size-4" /> Manage billing</Button>}
    </Card>
  );
}

export default function Home() {
  const { me, refresh } = useSession();
  const [params] = useSearchParams();
  useEffect(() => {   // after Checkout the webhook may land a moment later: poll briefly
    if (params.get("billing") !== "success") return;
    let n = 0;
    const t = setInterval(() => { refresh(); if (++n >= 6) clearInterval(t); }, 2500);
    return () => clearInterval(t);
  }, [params, refresh]);
  if (!me) return null;
  return (
    <div className="space-y-10">
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white">Hi, {me.display_name.split(" ")[0]}</h1>
        <p className="mt-1 text-zinc-400">Signed in as {me.plex?.username ?? me.display_name} on Plex</p>
      </div>
      {params.get("billing") === "success" && <Notice tone="success">Thanks for subscribing! Your invite is sent as soon as Stripe confirms the payment (usually a few seconds).</Notice>}
      <Access />
      <PlanSummary />
    </div>
    <TitleRows endpoint="/discover/home" />
    </div>
  );
}
