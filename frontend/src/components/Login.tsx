import React, { useState } from 'react';
import OAuthModal from './OAuthModal';

const TABS = [
  { key: 'email', label: 'Email' },
  { key: 'plex', label: 'Plex' },
  { key: 'admin', label: 'Admin' },
];

const Login: React.FC = () => {
  const [tab, setTab] = useState<'email' | 'plex' | 'admin'>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [oauthProvider, setOAuthProvider] = useState<null | 'plex' | 'google'>(null);

  const handleOAuth = (provider: 'plex' | 'google') => setOAuthProvider(provider);
  const closeOAuth = () => setOAuthProvider(null);

  const submitLogin = async (emailVal: string, passwordVal: string) => {
    setError(null);
    setLoading(true);
    try {
      const csrfRes = await fetch('/api/csrf-token', { credentials: 'include' });
      const { csrf_token } = await csrfRes.json();

      const body = new URLSearchParams({ email: emailVal, password: passwordVal });
      const res = await fetch('/login/email', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-CSRFToken': csrf_token,
        },
        body: body.toString(),
      });
      const data = await res.json();
      if (data.success) {
        window.location.href = '/account';
      } else {
        setError(data.message || 'Login failed.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{
        backgroundImage: 'linear-gradient(rgba(0,0,0,0.70), rgba(0,0,0,0.80)), url(/img/moviewallpaper.png)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <div className="bg-black/60 backdrop-blur-sm border border-white/10 p-8 rounded-xl shadow-2xl w-full max-w-md flex flex-col gap-6">
        <a href="/" className="text-[#ff6a00] font-extrabold text-2xl text-center mb-2 block hover:opacity-80 transition">Elements Plex</a>
        <div className="flex gap-2 mb-4 border-b border-white/20">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`px-4 py-2 font-semibold text-lg border-b-4 transition-all ${tab === t.key ? 'border-[#ff6a00] text-[#ff6a00]' : 'border-transparent text-white/60 hover:text-white'}`}
              onClick={() => { setTab(t.key as typeof tab); setError(null); }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="bg-red-500/20 border border-red-500/50 text-red-300 px-4 py-2 rounded text-sm">{error}</div>
        )}

        {tab === 'email' && (
          <form className="flex flex-col gap-4" onSubmit={e => { e.preventDefault(); submitLogin(email, password); }}>
            <h1 className="text-2xl font-bold text-[#ff6a00] mb-2">Sign In</h1>
            <input
              type="email"
              placeholder="Email"
              className="px-4 py-3 rounded bg-black/50 border border-white/20 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-[#ff6a00]"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
            <input
              type="password"
              placeholder="Password"
              className="px-4 py-3 rounded bg-black/50 border border-white/20 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-[#ff6a00]"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
            <button
              type="submit"
              disabled={loading}
              className="bg-[#ff6a00] hover:bg-orange-500 text-white font-semibold py-3 rounded transition disabled:opacity-60"
            >
              {loading ? 'Signing in…' : 'Login'}
            </button>
          </form>
        )}

        {tab === 'plex' && (
          <div className="flex flex-col gap-4 items-center">
            <h1 className="text-2xl font-bold text-[#ff6a00] mb-2">Sign in with Plex</h1>
            <button
              className="bg-[#ff6a00] hover:bg-orange-500 text-white font-semibold py-3 px-6 rounded transition w-full"
              onClick={() => handleOAuth('plex')}
            >
              Continue with Plex
            </button>
          </div>
        )}

        {tab === 'admin' && (
          <form className="flex flex-col gap-4" onSubmit={e => { e.preventDefault(); submitLogin(adminEmail, adminPassword); }}>
            <h1 className="text-2xl font-bold text-[#ff6a00] mb-2">Admin Login</h1>
            <input
              type="email"
              placeholder="Admin email"
              className="px-4 py-3 rounded bg-black/50 border border-white/20 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-[#ff6a00]"
              value={adminEmail}
              onChange={e => setAdminEmail(e.target.value)}
              required
            />
            <input
              type="password"
              placeholder="Password"
              className="px-4 py-3 rounded bg-black/50 border border-white/20 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-[#ff6a00]"
              value={adminPassword}
              onChange={e => setAdminPassword(e.target.value)}
              required
            />
            <button
              type="submit"
              disabled={loading}
              className="bg-[#ff6a00] hover:bg-orange-500 text-white font-semibold py-3 rounded transition disabled:opacity-60"
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        )}

        <div className="flex flex-col gap-2 mt-2">
          <button
            type="button"
            className="bg-white/10 border border-white/20 text-white py-2 rounded hover:bg-white/20 transition"
            onClick={() => handleOAuth('google')}
          >
            Sign in with Google
          </button>
        </div>
      </div>
      {oauthProvider && (
        <OAuthModal provider={oauthProvider} onClose={closeOAuth} />
      )}
    </div>
  );
};

export default Login;
