import { CalendarClock, ChevronLeft, ChevronRight, Film, Sparkles, Tv } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, type HomeRows, type Title } from "../api";
import { useSession } from "../session";

// "New on the server" and "Coming soon" from Seerr, for members (with links) and, if the admin allows it, visitors (without).
function shortDate(iso: string) {
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function Poster({ t, caption }: { t: Title; caption: string }) {
  const body = (
    <>
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl border border-white/[0.06] bg-ink-850">
        {t.poster ? <img src={t.poster} alt="" loading="lazy" className="size-full object-cover transition duration-300 group-hover:scale-105" />
          : <div className="grid size-full place-items-center p-3 text-center text-sm text-zinc-500">{t.title}</div>}
        {t.type === "tv" && <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded bg-ink-950/80 px-1.5 py-0.5 text-[10px] font-medium uppercase text-zinc-200"><Tv className="size-3" /> Series</span>}
      </div>
      <p className="mt-2 truncate text-sm text-zinc-100">{t.title}</p>
      <p className="truncate text-xs text-zinc-500">{caption}</p>
    </>
  );
  const cls = "group block w-32 shrink-0 snap-start sm:w-36";
  return t.url ? <a href={t.url} target="_blank" rel="noreferrer" className={cls}>{body}</a> : <div className={cls}>{body}</div>;
}

function Shelf({ icon: Icon, title, subtitle, children }: { icon: typeof Film; title: string; subtitle: string; children: ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  const [can, setCan] = useState({ left: false, right: false });
  const update = useCallback(() => {
    const el = row.current;
    if (el) setCan({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [update, children]);
  const scroll = (dir: 1 | -1) => row.current?.scrollBy({ left: dir * row.current.clientWidth * 0.8, behavior: "smooth" });
  const arrow = "absolute top-[38%] z-10 grid size-10 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-ink-950/50 text-white backdrop-blur transition hover:bg-ink-950/80";
  return (
    <section>
      <div className="mb-3 flex items-end gap-3">
        <span className="grid size-9 place-items-center rounded-xl border border-white/10 bg-ink-850"><Icon className="size-4 text-gold" /></span>
        <div><h2 className="text-lg font-semibold text-white">{title}</h2><p className="text-sm text-zinc-400">{subtitle}</p></div>
      </div>
      <div className="relative">
        <div ref={row} onScroll={update} className="no-scrollbar -mx-4 flex snap-x scroll-px-4 gap-4 overflow-x-auto px-4">{children}</div>
        {can.left && <button type="button" aria-label="Scroll left" onClick={() => scroll(-1)} className={`${arrow} left-1`}><ChevronLeft className="size-5" /></button>}
        {can.right && <button type="button" aria-label="Scroll right" onClick={() => scroll(1)} className={`${arrow} right-1`}><ChevronRight className="size-5" /></button>}
      </div>
    </section>
  );
}

export default function TitleRows({ endpoint }: { endpoint: "/discover/home" | "/discover/public" }) {
  const { me, config } = useSession();
  const [rows, setRows] = useState<HomeRows | null>(null);
  useEffect(() => { api<HomeRows>(endpoint).then(setRows).catch(() => {}); }, [endpoint]);
  if (!rows?.enabled || (!rows.new.length && !rows.upcoming.length)) return null;
  const server = me?.server_name || config?.server_name || "the server";
  const visitor = endpoint === "/discover/public";
  const year = (t: Title) => (t.release_date ? t.release_date.slice(0, 4) : "");
  return (
    <div className="space-y-10 border-t border-white/[0.06] pt-8">
      {rows.new.length > 0 && (
        <Shelf icon={Sparkles} title={`New on ${server}`} subtitle={visitor ? "Trending right now, and ready to watch for members." : "Trending right now, and ready to watch."}>
          {rows.new.map((t) => <Poster key={`${t.type}${t.tmdb_id}`} t={t} caption={[year(t), t.status === 4 ? "Some episodes" : ""].filter(Boolean).join(" · ")} />)}
        </Shelf>
      )}
      {rows.upcoming.length > 0 && (
        <Shelf icon={CalendarClock} title="Coming soon" subtitle={`Requested, and added to ${server} when it's out.`}>
          {rows.upcoming.map((t) => <Poster key={`${t.type}${t.tmdb_id}`} t={t}
            caption={`${t.type === "tv" && t.next_air_date === t.date ? "New episode" : "Out"} ${shortDate(t.date ?? t.release_date ?? "")}`} />)}
        </Shelf>
      )}
    </div>
  );
}

