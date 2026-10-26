import { Gauge, MailCheck, MonitorPlay, Play, ShieldCheck, Tv } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useSession } from "../session";
import { linkButton } from "../ui";
import { PlanCard, PlanGrid } from "./PlanCards";
import type { PlansResponse } from "./Pricing";
import { PlexButton } from "./SignIn";
import TitleRows from "./TitleRows";

const STEPS = [
  { icon: Play, title: "Sign in with Plex", text: "Use the Plex account you already watch with. No new password." },
  { icon: Gauge, title: "Pick a plan", text: "Choose how many screens at once, the quality, and the libraries." },
  { icon: MailCheck, title: "Accept the invite", text: "Plex sends you an invite straight away. Accept it and start watching." },
];

const PERKS = [
  { icon: Tv, title: "Watch anywhere", text: "Every Plex app: TV, phone, tablet, browser, console." },
  { icon: MonitorPlay, title: "Streams you choose", text: "Plans for one screen or the whole household." },
  { icon: ShieldCheck, title: "Simple billing", text: "Pay monthly with Stripe and cancel any time from your account." },
];

function Plans() {
  const [data, setData] = useState<PlansResponse | null>(null);
  useEffect(() => { api<PlansResponse>("/plans").then(setData).catch(() => {}); }, []);
  const plans = data?.plans.filter((p) => p.price_cents > 0) ?? [];
  if (!plans.length) return null;
  return (
    <section className="border-t border-white/[0.06] pt-12">
      <h2 className="text-center text-3xl font-bold tracking-tight text-white">Plans</h2>
      <p className="mx-auto mt-2 max-w-xl text-center text-zinc-400">Sign in with Plex first, then pick one. You can change plans any time.</p>
      <div className="mt-8">
        <PlanGrid>
          {plans.map((p) => <PlanCard key={p.id} plan={p} action={
            <Link to="/signin?next=/pricing" className={linkButton(p.highlight ? "primary" : "secondary", "w-full")}>Get {p.name}</Link>} />)}
        </PlanGrid>
      </div>
    </section>
  );
}

export default function Landing() {
  const { config } = useSession();
  const tagline = config?.site_tagline || "Pick a plan. Press play.";
  const [first, ...rest] = tagline.split(".");
  return (
    <div className="space-y-14">
      <div className="grid items-center gap-12 py-6 lg:grid-cols-[1.15fr_1fr] lg:py-12">
        <div>
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-300">
            <Play className="size-3.5 fill-gold text-gold" /> {config?.server_name ? `Join ${config.server_name}` : "Your seat on the server"}
          </p>
          <h1 className="text-4xl font-bold leading-[1.1] tracking-tight text-white sm:text-6xl">
            {first}.<br /><span className="text-gradient">{rest.join(".").trim() || "Press play."}</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-zinc-400">
            Movies and shows on {config?.server_name || "our Plex server"}, in every Plex app you already use. Choose a plan that fits how you watch.
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {PERKS.map(({ icon: Icon, title, text }) => (
              <div key={title}>
                <span className="grid size-9 place-items-center rounded-xl border border-white/10 bg-ink-850"><Icon className="size-4 text-gold" /></span>
                <h3 className="mt-3 text-sm font-semibold text-white">{title}</h3>
                <p className="text-sm text-zinc-400">{text}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="relative">
          <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-brand opacity-10 blur-3xl" />
          <div className="card p-6 sm:p-8">
            <h2 className="text-xl font-semibold text-white">Get started</h2>
            <ol className="mb-6 mt-5 space-y-4">
              {STEPS.map(({ icon: Icon, title, text }, i) => (
                <li key={title} className="flex gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full border border-gold/40 bg-gold/10 text-sm font-semibold text-gold">{i + 1}</span>
                  <div><p className="flex items-center gap-2 text-sm font-medium text-white"><Icon className="size-3.5 text-zinc-400" />{title}</p>
                    <p className="text-sm text-zinc-400">{text}</p></div>
                </li>
              ))}
            </ol>
            {config?.signup_open === false
              ? <p className="text-sm text-zinc-400">New sign-ups are closed right now. Members can still <Link to="/signin" className="text-plex">sign in</Link>.</p>
              : <PlexButton />}
          </div>
        </div>
      </div>
      <TitleRows endpoint="/discover/public" />
      <Plans />
    </div>
  );
}
