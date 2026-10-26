import { Check, Download, Film, Gauge, Minus, MonitorPlay, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { money, qualityText, streamsText, type Plan } from "../api";
import { formatDate } from "../ui";

function Line({ on = true, icon, children }: { on?: boolean; icon?: ReactNode; children: ReactNode }) {
  return (
    <li className={`flex gap-2 ${on ? "text-zinc-300" : "text-zinc-600"}`}>
      <span className="mt-0.5 shrink-0">{on ? icon ?? <Check className="size-4 text-gold" /> : <Minus className="size-4" />}</span>
      <span>{children}</span>
    </li>
  );
}

export function PlanFeatures({ plan }: { plan: Plan }) {
  const libs = plan.limits.all_libraries ? "Every library on the server"
    : plan.libraries.length ? plan.libraries.join(", ") : "Selected libraries";
  return (
    <ul className="space-y-2.5 text-sm">
      {plan.perks.map((x) => <Line key={x}>{x}</Line>)}
      <Line icon={<MonitorPlay className="size-4 text-gold" />}>{streamsText(plan.limits.max_streams)}</Line>
      <Line icon={<Gauge className="size-4 text-gold" />}>{qualityText(plan.limits.max_resolution_label)}</Line>
      <Line icon={<Film className="size-4 text-gold" />}>{libs}</Line>
      <Line on={plan.limits.allow_downloads} icon={<Download className="size-4 text-gold" />}>Downloads for offline viewing</Line>
    </ul>
  );
}

export function PlanCard({ plan, current, action }: { plan: Plan; current?: boolean; action: ReactNode }) {
  const promo = plan.promotion;
  const discounted = promo?.percent_off ? Math.round(plan.price_cents * (100 - promo.percent_off) / 100) : null;
  return (
    <div className={`card relative flex flex-col p-6 ${plan.highlight ? "border-gold/50 shadow-2xl shadow-gold/10" : ""} ${current ? "ring-1 ring-gold/40" : ""}`}>
      {plan.highlight && <span className="bg-gradient-brand absolute -top-3 left-6 rounded-full px-3 py-0.5 text-xs font-semibold text-ink-950">Most popular</span>}
      <h2 className="text-lg font-semibold text-white">{plan.name}</h2>
      <p className="mt-1 min-h-10 text-sm text-zinc-400">{plan.description}</p>
      <p className="mt-4 text-4xl font-bold text-white">
        {discounted !== null && <span className="mr-2 text-2xl font-medium text-zinc-500 line-through">{money(plan.price_cents, plan.currency)}</span>}
        {plan.price_cents ? money(discounted ?? plan.price_cents, plan.currency) : "Free"}
        {plan.price_cents > 0 && <span className="text-base font-normal text-zinc-500"> / {plan.interval}</span>}
      </p>
      {promo && (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-gold/30 bg-gold/10 px-3 py-2 text-sm text-gold">
          <Sparkles className="mt-0.5 size-4 shrink-0" />
          <span><b>{promo.summary}</b>{promo.first_subscription_only ? " for new members" : ""}
            {promo.ends_at ? <span className="text-gold/70"> · ends {formatDate(promo.ends_at)}</span> : null}</span>
        </p>
      )}
      <div className="mt-6 flex-1"><PlanFeatures plan={plan} /></div>
      <div className="mt-6">{action}</div>
    </div>
  );
}

export function PlanGrid({ children }: { children: ReactNode }) {
  return <div className="mx-auto grid max-w-5xl gap-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(15rem, 1fr))" }}>{children}</div>;
}
