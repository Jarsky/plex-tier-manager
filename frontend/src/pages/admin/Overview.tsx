import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { useSession } from "../../session";
import { Card, errorText, Notice, Spinner } from "../../ui";

type Stats = {
  days: number; users: number; new_users: number;
  access: { shared: number; invited: number; none: number; unmanaged: number; errors: number };
  plans: { name: string; members: number; paying: number }[];
  enforcement: { streams: number; quality: number };
  signups_per_day: { date: string; count: number }[];
};

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="card p-5">
      <p className="text-xs uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums text-white">{value.toLocaleString()}</p>
      {sub && <p className="text-xs text-zinc-500">{sub}</p>}
    </div>
  );
}

export default function Overview() {
  const { config } = useSession();
  const [stats, setStats] = useState<Stats | null>(null);
  const [days, setDays] = useState(30);
  const [error, setError] = useState("");
  useEffect(() => { api<Stats>(`/admin/stats?days=${days}`).then(setStats).catch((e) => setError(errorText(e))); }, [days]);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!stats || !config) return <Spinner />;
  const setup: [boolean, string, string][] = [
    [!config.plex_ready, "Connect your Plex server so members can be invited.", "/admin/plex"],
    [!config.billing_enabled, "Paid plans are off. Add your plans and Stripe key, then turn on “Sell paid plans”.", "/admin/billing"],
    [stats.access.unmanaged > 0, `${stats.access.unmanaged} existing friend(s) joined but have no plan yet.`, "/admin/plex"],
    [stats.access.errors > 0, `${stats.access.errors} member(s) had a Plex error on the last check.`, "/admin/users"],
  ];
  const peak = Math.max(1, ...stats.signups_per_day.map((d) => d.count));
  const paying = stats.plans.reduce((a, p) => a + p.paying, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-white">Overview</h2>
        <select className="input !w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[7, 30, 90, 365].map((d) => <option key={d} value={d}>Last {d} days</option>)}
        </select>
      </div>
      {setup.filter(([on]) => on).map(([, text, to]) => <Notice key={text} tone="warn">{text} <Link className="underline" to={to}>Fix it</Link></Notice>)}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Members" value={stats.users} sub={`+${stats.new_users} in ${days} days`} />
        <Stat label="On the server" value={stats.access.shared} sub={stats.access.invited ? `${stats.access.invited} invite(s) pending` : undefined} />
        <Stat label="Paying" value={paying} />
        <Stat label="Streams stopped / flagged" value={stats.enforcement.streams + stats.enforcement.quality}
          sub={`${stats.enforcement.streams} over stream count · ${stats.enforcement.quality} over quality`} />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Members by plan">
          {!stats.plans.length ? <p className="text-sm text-zinc-500">Nobody has a plan yet.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-zinc-500"><th className="pb-2 font-medium">Plan</th><th className="pb-2 text-right font-medium">Members</th><th className="pb-2 text-right font-medium">Paying</th></tr></thead>
              <tbody className="divide-y divide-white/5">
                {stats.plans.map((p) => <tr key={p.name}><td className="py-2 text-zinc-200">{p.name}</td><td className="py-2 text-right tabular-nums">{p.members}</td>
                  <td className="py-2 text-right tabular-nums text-zinc-400">{p.paying}</td></tr>)}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Sign-ups per day">
          {stats.signups_per_day.length ? (
            <div className="flex h-32 items-end gap-1">
              {stats.signups_per_day.map((d) => (
                <div key={d.date} title={`${d.date}: ${d.count}`} className="flex-1 rounded-t bg-gold/70 hover:bg-gold" style={{ height: `${(d.count / peak) * 100}%`, minHeight: 2 }} />
              ))}
            </div>
          ) : <p className="text-sm text-zinc-500">No sign-ups in this period.</p>}
        </Card>
      </div>
    </div>
  );
}
