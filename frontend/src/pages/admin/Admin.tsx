import { BarChart3, CreditCard, LifeBuoy, Mail, MonitorPlay, ScrollText, Server, SlidersHorizontal, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api } from "../../api";
import AuditPage from "./Audit";
import Billing from "./Billing";
import Overview from "./Overview";
import PlexPage from "./Plex";
import { EmailSettings, SiteSettings } from "./SettingsPages";
import Streams from "./Streams";
import SupportInbox, { SupportTicketPage } from "./Support";
import UserDetail from "./UserDetail";
import UsersPage from "./Users";

const TABS = [
  { to: "", label: "Overview", icon: BarChart3 },
  { to: "users", label: "Members", icon: Users },
  { to: "streams", label: "Streams", icon: MonitorPlay },
  { to: "plex", label: "Plex server", icon: Server },
  { to: "billing", label: "Plans & billing", icon: CreditCard },
  { to: "support", label: "Support", icon: LifeBuoy },
  { to: "audit", label: "Audit log", icon: ScrollText },
  { to: "email", label: "Email", icon: Mail },
  { to: "site", label: "Site", icon: SlidersHorizontal },
];

export default function Admin() {
  const { pathname } = useLocation();
  const [openTickets, setOpenTickets] = useState(0);
  useEffect(() => { api<{ counts: Record<string, number> }>("/admin/support?status=open").then((r) => setOpenTickets(r.counts.open ?? 0)).catch(() => {}); }, [pathname]);
  const tab = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition ${isActive ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-white"}`;
  return (
    <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <aside>
        <h1 className="mb-4 hidden px-3 text-xs font-semibold uppercase tracking-wider text-zinc-500 lg:block">Admin</h1>
        <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:px-0">
          {TABS.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={`/admin/${to}`} end={to === ""} className={tab}><Icon className="size-4" /> {label}
              {to === "support" && openTickets > 0 && <span className="ml-auto rounded-full bg-plex/20 px-1.5 text-[11px] font-semibold text-plex">{openTickets}</span>}</NavLink>
          ))}
        </nav>
      </aside>
      <div className="min-w-0">
        <Routes>
          <Route index element={<Overview />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="users/:id" element={<UserDetail />} />
          <Route path="streams" element={<Streams />} />
          <Route path="plex" element={<PlexPage />} />
          <Route path="billing" element={<Billing />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="support" element={<SupportInbox />} />
          <Route path="support/:id" element={<SupportTicketPage />} />
          <Route path="email" element={<EmailSettings />} />
          <Route path="site" element={<SiteSettings />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </div>
    </div>
  );
}
