import React, { useEffect, useState, useRef } from 'react';
import { fetchSiteConfig } from '../api';

const Navbar: React.FC = () => {
  const [user, setUser] = useState<{ username?: string; email?: string; role?: number } | null>(null);
  const [siteTitle, setSiteTitle] = useState('PTM');
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchSiteConfig()
      .then((config) => {
        setSiteTitle(config.site_title || 'PTM');
        document.documentElement.setAttribute('data-theme', config.theme || 'default');
      })
      .catch(() => {
        setSiteTitle('PTM');
      });
  }, []);

  useEffect(() => {
    const onSiteConfigUpdated = (e: Event) => {
      const customEvent = e as CustomEvent<{ site_title?: string; theme?: string }>;
      const title = customEvent.detail?.site_title;
      const theme = customEvent.detail?.theme;
      if (title) setSiteTitle(title);
      if (theme) document.documentElement.setAttribute('data-theme', theme);
    };

    window.addEventListener('ptm:site-config-updated', onSiteConfigUpdated as EventListener);
    return () => window.removeEventListener('ptm:site-config-updated', onSiteConfigUpdated as EventListener);
  }, []);

  useEffect(() => {
    fetch('/api/auth/status', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        setUser(data.authenticated ? data.user : null);
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleLogout = () => {
    fetch('/logout', { credentials: 'include' }).then(() => {
      window.location.href = '/';
    });
  };

  return (
    <nav className="fixed top-0 left-0 w-full z-50 bg-gradient-to-b from-black/80 to-transparent h-20">
      <div className="max-w-5xl mx-auto w-full flex items-center justify-between px-6 py-4 h-20">
      <div className="flex items-center gap-4">
        <a href="/" className="text-2xl font-bold text-netflix-orange tracking-tight hover:opacity-80 transition">{siteTitle}</a>
      </div>
      <div className="flex items-center gap-6 relative" ref={menuRef}>
        {!loading && user && (
          <>
            <a href="/account" className="text-white hover:text-netflix-orange transition font-semibold">Account</a>
            <button
              className="rounded-full bg-netflix-orange w-10 h-10 flex items-center justify-center shadow-lg hover:scale-105 transition font-bold text-lg"
              onClick={() => setMenuOpen(o => !o)}
              aria-label="User menu"
            >
              {user.username?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase() || '?'}
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-14 min-w-[220px] overflow-hidden rounded-xl border border-white/15 bg-black/90 backdrop-blur-md shadow-2xl z-50">
                <div className="px-4 py-3 text-sm text-white/70 border-b border-white/10 bg-white/5">
                  {user.username || user.email}
                </div>
                <div className="p-2 flex flex-col gap-1">
                  <a
                    href="/account"
                    className="w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg text-white/90 hover:bg-[#ff6a00]/20 hover:text-white transition"
                  >
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true" className="opacity-90">
                      <path d="M3 10.5L12 3l9 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M5.5 9.5V20h13V9.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Account
                  </a>
                  {user.role === 0 && (
                    <a
                      href="/admin"
                      className="w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg text-white/90 hover:bg-[#ff6a00]/20 hover:text-white transition"
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true" className="opacity-90">
                        <path d="M12 3l2.2 4.5 5 .7-3.6 3.6.8 5.1L12 14.7 7.6 17l.8-5.1L4.8 8.2l5-.7L12 3z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Admin
                    </a>
                  )}
                  <button
                    className="w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg text-white/90 hover:bg-white/10 hover:text-white transition"
                    onClick={handleLogout}
                  >
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true" className="opacity-90">
                      <path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M16 17l5-5-5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M21 12H9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Sign Out
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        {!loading && !user && (
          <a href="/login" className="bg-netflix-orange text-white font-semibold px-5 py-2 rounded hover:bg-orange-500 transition">Sign In</a>
        )}
      </div>
      </div>
    </nav>
  );
};

export default Navbar;
