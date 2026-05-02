import React, { useState, useEffect } from 'react';

import { changeUserPassword, fetchDashboardData } from '../api';
import type { User, Subscription } from '../types';

interface AccountProps {
  user?: User;
  subscriptions?: Subscription[];
}

const roleLabel = (role: 0 | 1 | 2) =>
  role === 0 ? 'Admin' : role === 1 ? 'Power User' : 'Member';

const Account: React.FC<AccountProps> = (props) => {
  const [section, setSection] = useState<'overview' | 'membership'>('overview');
  const [user, setUser] = useState<User | undefined>(props.user);
  const [subscriptions, setSubscriptions] = useState<Subscription[] | undefined>(props.subscriptions);
  const [loading, setLoading] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const isAdmin = user?.role === 0;

  useEffect(() => {
    if (!user || !subscriptions) {
      setLoading(true);
      fetchDashboardData()
        .then((data) => {
          setUser(data.user);
          setSubscriptions(data.subscriptions);
        })
        .catch(() => { window.location.href = '/login'; })
        .finally(() => setLoading(false));
    }
  }, []);

  const activeSubscriptions = subscriptions?.filter((sub) => sub.active) ?? [];

  const handlePasswordChange = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordMessage(null);
    setPasswordLoading(true);
    try {
      const res = await changeUserPassword(newPassword, confirmPassword);
      if (!res.success) throw new Error(res.message || 'Failed to change password');
      setPasswordMessage(res.message || 'Password changed successfully.');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setPasswordLoading(false);
    }
  };

  if (loading) {
    return (
      <main className="pt-24 px-4 min-h-screen bg-[#141414] text-white flex items-center justify-center">
        <div className="text-lg text-[#ff6a00] animate-pulse">Loading account...</div>
      </main>
    );
  }

  return (
    <main
      className="pt-24 pb-12 px-4 min-h-screen text-white"
      style={{
        backgroundImage: 'linear-gradient(rgba(20,20,20,0.96), rgba(20,20,20,0.98)), url(/img/moviewallpaper.png)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <div className="max-w-6xl mx-auto">
        <header className="mb-6">
          <h1 className="text-4xl font-extrabold tracking-tight">Account</h1>
          <p className="text-white/70 mt-1">Manage your account, subscription, and settings.</p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <aside className="lg:col-span-3 lg:sticky lg:top-28 lg:self-start">
            <div className="rounded-2xl border border-white/10 bg-black/45 backdrop-blur-sm p-3">
              <nav className="flex flex-col gap-2" aria-label="Account sections">
                <button
                  className={`text-left rounded-xl px-4 py-3 font-semibold transition ${section === 'overview' ? 'bg-[#ff6a00] text-white' : 'bg-white/5 text-white/85 hover:bg-white/10'}`}
                  onClick={() => setSection('overview')}
                >
                  Overview
                </button>
                <button
                  className={`text-left rounded-xl px-4 py-3 font-semibold transition ${section === 'membership' ? 'bg-[#ff6a00] text-white' : 'bg-white/5 text-white/85 hover:bg-white/10'}`}
                  onClick={() => setSection('membership')}
                >
                  Membership
                </button>
                {isAdmin && (
                  <a
                    href="/admin"
                    className="text-left rounded-xl px-4 py-3 font-semibold transition bg-white/5 text-white/85 hover:bg-white/10"
                  >
                    Admin Panel
                  </a>
                )}
              </nav>
            </div>
          </aside>

          <section className="rounded-2xl border border-white/10 bg-black/45 backdrop-blur-sm p-6 md:p-8 shadow-2xl lg:col-span-9">
            {section === 'overview' && (
              <>
                <h2 className="text-2xl font-bold mb-5">Overview</h2>

                <div className="grid grid-cols-1 md:grid-cols-[130px,1fr] gap-5 items-center rounded-2xl border border-white/10 bg-white/5 p-5 mb-6">
                  <div className="flex items-center justify-center w-28 h-28 rounded-full bg-[#ff6a00] text-4xl font-bold mx-auto md:mx-0">
                    {user?.username?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold">{user?.username || user?.email || 'Unknown User'}</h3>
                    <div className="flex flex-wrap gap-2 mt-2 mb-3">
                      <span className="px-3 py-1 rounded-full text-xs font-semibold bg-[#ff6a00]/25 border border-[#ff6a00]/40 text-[#ff944d]">{roleLabel(user?.role ?? 2)}</span>
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${user?.active ? 'bg-green-600/20 border border-green-500/40 text-green-300' : 'bg-gray-500/20 border border-gray-400/40 text-gray-300'}`}>{user?.active ? 'Active' : 'Disabled'}</span>
                    </div>
                    <p className="text-sm text-white/80"><span className="font-semibold text-white">Email:</span> {user?.email || '-'}</p>
                    <p className="text-sm text-white/80"><span className="font-semibold text-white">Member since:</span> {user?.created_at ? new Date(user.created_at).toLocaleDateString() : '-'}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs uppercase tracking-wider text-white/60">Plan status</div>
                    <div className="mt-2 text-xl font-bold">{activeSubscriptions.length > 0 ? 'Active' : 'Inactive'}</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs uppercase tracking-wider text-white/60">Active subscriptions</div>
                    <div className="mt-2 text-xl font-bold">{activeSubscriptions.length}</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs uppercase tracking-wider text-white/60">Account role</div>
                    <div className="mt-2 text-xl font-bold">{roleLabel(user?.role ?? 2)}</div>
                  </div>
                </div>

                <div className="mt-6">
                  <button
                    className="rounded bg-[#ff6a00] px-4 py-2 text-sm font-semibold hover:bg-orange-500 transition"
                    onClick={() => {
                      setPasswordModalOpen(true);
                      setPasswordError(null);
                      setPasswordMessage(null);
                    }}
                  >
                    Change Password
                  </button>
                </div>
              </>
            )}

            {section === 'membership' && (
              <>
                <h2 className="text-2xl font-bold mb-5">Membership</h2>

                {subscriptions && subscriptions.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {subscriptions.map((sub) => (
                      <article
                        key={sub.id}
                        className={`rounded-xl border p-5 ${sub.active ? 'bg-white/5 border-[#ff6a00]/40' : 'bg-white/5 border-white/10 opacity-75'}`}
                      >
                        <div className="flex items-center justify-between mb-4">
                          <span className="text-xl font-bold">{sub.tier || 'Standard'}</span>
                          <span className={`px-2 py-1 rounded text-xs font-bold ${sub.active ? 'bg-green-600/30 text-green-300 border border-green-500/40' : 'bg-gray-600/30 text-gray-200 border border-gray-500/40'}`}>{sub.active ? 'Active' : 'Inactive'}</span>
                        </div>
                        <div className="space-y-1 text-sm text-white/80">
                          <p><span className="text-white font-semibold">Started:</span> {sub.start_date ? new Date(sub.start_date).toLocaleDateString() : '-'}</p>
                          <p><span className="text-white font-semibold">Expires:</span> {sub.end_date ? new Date(sub.end_date).toLocaleDateString() : 'No expiry'}</p>
                          <p><span className="text-white font-semibold">Auto-renew:</span> {sub.renewal ? 'Yes' : 'No'}</p>
                          <p><span className="text-white font-semibold">Payment:</span> {sub.payment_status || '-'}</p>
                        </div>
                        {sub.notes && <p className="text-xs text-white/60 mt-3">{sub.notes}</p>}
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center">
                    <p className="text-white/80 mb-4">You do not have an active subscription.</p>
                    <a href="/#plans-section" className="inline-block bg-[#ff6a00] hover:bg-orange-500 text-white font-semibold px-5 py-2 rounded transition">
                      View Plans
                    </a>
                  </div>
                )}
              </>
            )}

          </section>
        </div>
      </div>

      {passwordModalOpen && (
        <div className="fixed inset-0 z-[95] bg-black/70 flex items-center justify-center p-4" onClick={() => setPasswordModalOpen(false)}>
          <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#121212] p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold">Change Password</h3>
              <button className="text-white/70 hover:text-white" onClick={() => setPasswordModalOpen(false)}>Close</button>
            </div>

            <form className="flex flex-col gap-3" onSubmit={handlePasswordChange}>
              <input
                type="password"
                required
                minLength={6}
                placeholder="New password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="px-4 py-3 rounded bg-black/60 border border-white/30 text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-[#ff6a00]"
              />
              <input
                type="password"
                required
                minLength={6}
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="px-4 py-3 rounded bg-black/60 border border-white/30 text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-[#ff6a00]"
              />
              <button type="submit" disabled={passwordLoading} className="bg-[#ff6a00] hover:bg-orange-500 text-white font-semibold py-3 rounded transition disabled:opacity-60">
                {passwordLoading ? 'Saving...' : 'Update Password'}
              </button>
            </form>

            {passwordError && <div className="mt-3 text-sm text-red-300">{passwordError}</div>}
            {passwordMessage && <div className="mt-3 text-sm text-green-300">{passwordMessage}</div>}
          </div>
        </div>
      )}
    </main>
  );
};

export default Account;
