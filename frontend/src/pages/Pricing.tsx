import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type Plan } from "../api";
import { useSession } from "../session";
import { Button, errorText, linkButton, Notice, Spinner, useToast } from "../ui";
import { PlanCard, PlanGrid } from "./PlanCards";

export async function openBillingPortal(toast: (t: string, tone?: "error") => void) {
  try { window.location.assign((await api<{ url: string }>("/billing/portal", { method: "POST" })).url); }
  catch (e) { toast(errorText(e), "error"); }
}

export type PlansResponse = { billing_enabled: boolean; plans: Plan[]; server_name: string };

export default function Pricing() {
  const { me, config } = useSession();
  const toast = useToast();
  const [params] = useSearchParams();
  const [data, setData] = useState<PlansResponse | null>(null);
  const [busy, setBusy] = useState("");
  useEffect(() => { api("/plans").then(setData).catch((e) => toast(errorText(e), "error")); }, [toast]);
  if (!data) return <Spinner />;

  const current = me?.membership.plan?.id;
  const subscribed = me && ["active", "trialing", "past_due"].includes(me.membership.status ?? "") && me.membership.source === "stripe";
  const choose = async (p: Plan) => {
    if (subscribed) return openBillingPortal(toast);
    setBusy(p.id);
    try { window.location.assign((await api<{ url: string }>("/billing/checkout", { body: { plan_id: p.id } })).url); }
    catch (e) { toast(errorText(e), "error"); setBusy(""); }
  };
  const server = data.server_name || config?.server_name || "the server";

  return (
    <div>
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-4xl font-bold tracking-tight text-white">Plans</h1>
        <p className="mt-3 text-zinc-400">Every plan gets you onto {server}. Pick how many screens you watch on at once, the quality, and the libraries.</p>
      </div>
      {params.get("billing") === "cancelled" && <div className="mx-auto mt-6 max-w-xl"><Notice>Checkout was cancelled. Nothing was charged.</Notice></div>}
      {me?.membership.source === "admin" && me.membership.plan && <div className="mx-auto mt-6 max-w-xl"><Notice>
        You're on the <b>{me.membership.plan.name}</b> plan, set by the server admin.</Notice></div>}
      {!data.plans.length && <p className="mt-10 text-center text-zinc-500">No plans are set up yet.</p>}
      <div className="mt-10">
        <PlanGrid>
          {data.plans.map((p) => (
            <PlanCard key={p.id} plan={p} current={current === p.id} action={
              current === p.id ? <span className={linkButton("secondary", "w-full cursor-default")}>Your plan</span>
                : !me ? <Link to="/signin?next=/pricing" className={linkButton(p.highlight ? "primary" : "secondary", "w-full")}>Sign in with Plex to start</Link>
                : p.purchasable ? <Button variant={p.highlight ? "primary" : "secondary"} className="w-full" loading={busy === p.id} onClick={() => choose(p)}>
                    {subscribed ? "Switch plan" : p.promotion?.trial_days ? `Start ${p.promotion.trial_days}-day free trial` : `Get ${p.name}`}</Button>
                : <span className="block text-center text-xs text-zinc-500">{p.price_cents ? "Not available yet" : "Given by the server admin"}</span>
            } />
          ))}
        </PlanGrid>
      </div>
      {data.billing_enabled && <p className="mt-8 text-center text-xs text-zinc-500">Payments are handled securely by Stripe. Cancel any time from your account;
        your access lasts until the end of the period you've paid for. Have a promo code? Enter it on the payment page.</p>}
    </div>
  );
}
