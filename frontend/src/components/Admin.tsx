import React, { useEffect, useState } from 'react';

import {
  fetchAuthStatus,
  fetchAdminUsers,
  fetchPlexUsers,
  fetchAdminSiteSettings,
  saveSiteTitle,
  saveTheme,
  saveAdminUser,
  deleteAdminUser,
  unlinkAdminPlex,
  changeAdminPassword,
  assignAdminPlan,
  fetchAdminUserSummary,
  saveIntegrationSectionSettings,
  type ThemeOption,
  type IntegrationField,
} from '../api';
import type { User } from '../types';
import type { AdminUserEntry, PlexUser } from '../types-admin';

type AdminSection = 'users' | 'site' | 'plex-users';
type IntegrationSection = 'plex' | 'tautulli' | 'stripe';

const roleLabel = (role: number) => (role === 0 ? 'Admin' : role === 1 ? 'Power User' : 'Member');

const Admin: React.FC = () => {
  const [section, setSection] = useState<AdminSection>('users');
  const [user, setUser] = useState<User | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminUserEntry[]>([]);
  const [plexUsers, setPlexUsers] = useState<PlexUser[]>([]);
  const [siteTitle, setSiteTitle] = useState('');
  const [theme, setThemeValue] = useState('default');
  const [themeOptions, setThemeOptions] = useState<ThemeOption[]>([{ key: 'default', label: 'Default (PTM)' }]);
  const [integrationValues, setIntegrationValues] = useState<Record<string, string>>({});
  const [integrationMeta, setIntegrationMeta] = useState<Record<string, Record<string, IntegrationField>>>({});
  const [loading, setLoading] = useState(true);
  const [adminLoadError, setAdminLoadError] = useState<string | null>(null);
  const [plexError, setPlexError] = useState<string | null>(null);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [summaryHtml, setSummaryHtml] = useState<string | null>(null);
  const [summaryTitle, setSummaryTitle] = useState<string>('User Summary');
  const [integrationMessage, setIntegrationMessage] = useState<string | null>(null);
  const [integrationError, setIntegrationError] = useState<string | null>(null);
  const [integrationSaving, setIntegrationSaving] = useState<IntegrationSection | null>(null);
  const [managingEntry, setManagingEntry] = useState<AdminUserEntry | null>(null);
  const [manageRole, setManageRole] = useState<string>('2');
  const [manageActive, setManageActive] = useState<string>('1');
  const [planTier, setPlanTier] = useState<string>('basic');
  const [planStartDate, setPlanStartDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [planEndDate, setPlanEndDate] = useState<string>('');
  const [managePassword, setManagePassword] = useState<string>('');
  const [manageBusy, setManageBusy] = useState<'save' | 'plan' | 'password' | 'unlink' | 'delete' | null>(null);
  const [manageMessage, setManageMessage] = useState<string | null>(null);
  const [manageError, setManageError] = useState<string | null>(null);

  const loadAdmin = async () => {
    setLoading(true);
    try {
      const auth = await fetchAuthStatus();
      if (!auth.authenticated || !auth.user) {
        window.location.href = '/login';
        return;
      }

      setUser(auth.user);

      if (auth.user.role !== 0) {
        setAdminLoadError('Admin access required.');
        return;
      }

      const [users, settings] = await Promise.all([
        fetchAdminUsers(),
        fetchAdminSiteSettings(),
      ]);

      setAdminUsers(users);
      setSiteTitle(settings.site_title || 'PTM');
      setThemeValue(settings.theme || 'default');
      setThemeOptions(settings.theme_options?.length ? settings.theme_options : [{ key: 'default', label: 'Default (PTM)' }]);
      setIntegrationMeta(settings.integrations || {});

      const initialIntegrationValues: Record<string, string> = {};
      Object.values(settings.integrations || {}).forEach((group) => {
        Object.entries(group).forEach(([key, field]) => {
          initialIntegrationValues[key] = field.value || '';
        });
      });
      setIntegrationValues(initialIntegrationValues);

      setAdminLoadError(null);

      try {
        const plex = await fetchPlexUsers();
        setPlexUsers(plex);
        setPlexError(null);
      } catch (e) {
        setPlexUsers([]);
        setPlexError(e instanceof Error ? e.message : 'Failed to load Plex users');
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('Session expired')) {
        window.location.href = '/login';
        return;
      }
      setAdminLoadError(error instanceof Error ? error.message : 'Failed to load admin panel.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAdmin();
  }, []);

  const openManageModal = (entry: AdminUserEntry) => {
    setManagingEntry(entry);
    setManageRole(String(entry.user.role));
    setManageActive(entry.user.active ? '1' : '0');
    setPlanTier('basic');
    setPlanStartDate(new Date().toISOString().slice(0, 10));
    setPlanEndDate('');
    setManagePassword('');
    setManageMessage(null);
    setManageError(null);
  };

  const closeManageModal = () => {
    setManagingEntry(null);
    setManageBusy(null);
    setManageMessage(null);
    setManageError(null);
  };

  const handleUserSave = async () => {
    if (!managingEntry || (user && managingEntry.user.id === user.id)) return;

    setManageBusy('save');
    try {
      const res = await saveAdminUser(managingEntry.user.id, Number(manageRole), manageActive === '1');
      if (!res.success) throw new Error(res.message || 'Failed to save user');
      await loadAdmin();
      setSettingsMessage(res.message || 'User saved.');
      setManageMessage(res.message || 'User saved.');
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : 'Failed to save user';
      setSettingsError(errMsg);
      setManageError(errMsg);
    } finally {
      setManageBusy(null);
    }
  };

  const handleAssignPlan = async () => {
    if (!managingEntry) return;
    if (!planTier || !planStartDate) {
      setManageError('Tier and start date are required.');
      return;
    }

    setManageBusy('plan');
    try {
      const res = await assignAdminPlan(managingEntry.user.id, planTier, planStartDate, planEndDate || undefined);
      if (!res.success) throw new Error(res.message || 'Failed to assign plan');
      await loadAdmin();
      setSettingsMessage(res.message || 'Plan assigned.');
      setManageMessage(res.message || 'Plan assigned.');
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : 'Failed to assign plan';
      setSettingsError(errMsg);
      setManageError(errMsg);
    } finally {
      setManageBusy(null);
    }
  };

  const handleDeleteUser = async () => {
    if (!managingEntry) return;
    if (user?.id === managingEntry.user.id) return;
    if (!window.confirm(`Delete user ${managingEntry.user.email || managingEntry.user.username || managingEntry.user.id}?`)) return;
    setManageBusy('delete');
    try {
      const res = await deleteAdminUser(managingEntry.user.id);
      if (!res.success) throw new Error(res.message || 'Failed to delete user');
      await loadAdmin();
      setSettingsMessage(res.message || 'User deleted.');
      closeManageModal();
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : 'Failed to delete user';
      setSettingsError(errMsg);
      setManageError(errMsg);
    } finally {
      setManageBusy(null);
    }
  };

  const handleUnlinkPlex = async () => {
    if (!managingEntry) return;
    if (!window.confirm(`Unlink Plex account for ${managingEntry.user.email || managingEntry.user.username || managingEntry.user.id}?`)) return;
    setManageBusy('unlink');
    try {
      const res = await unlinkAdminPlex(managingEntry.user.id);
      if (!res.success) throw new Error(res.message || 'Failed to unlink Plex');
      await loadAdmin();
      setSettingsMessage(res.message || 'Plex account unlinked.');
      setManageMessage(res.message || 'Plex account unlinked.');
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : 'Failed to unlink Plex';
      setSettingsError(errMsg);
      setManageError(errMsg);
    } finally {
      setManageBusy(null);
    }
  };

  const handleChangePassword = async () => {
    if (!managingEntry) return;
    if (!managePassword) {
      setManageError('Please enter a new password.');
      return;
    }
    setManageBusy('password');
    try {
      const res = await changeAdminPassword(managingEntry.user.id, managePassword);
      if (!res.success) throw new Error(res.message || 'Failed to change password');
      setSettingsMessage(res.message || 'Password changed.');
      setManageMessage(res.message || 'Password changed.');
      setManagePassword('');
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : 'Failed to change password';
      setSettingsError(errMsg);
      setManageError(errMsg);
    } finally {
      setManageBusy(null);
    }
  };

  const handleOpenSummary = async (entry: AdminUserEntry) => {
    try {
      const res = await fetchAdminUserSummary(entry.user.id);
      if (!res.success) throw new Error(res.message || 'Failed to load summary');
      setSummaryTitle(`User Summary: ${entry.user.email || entry.user.username || entry.user.id}`);
      setSummaryHtml(res.html || '<p>No summary available.</p>');
    } catch (e) {
      setSummaryTitle('User Summary');
      setSummaryHtml(`<p>${e instanceof Error ? e.message : 'Failed to load summary'}</p>`);
    }
  };

  const handleSaveSiteSettings = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const cleanTitle = siteTitle.trim();
    if (!cleanTitle) {
      setSettingsError('Site title cannot be empty.');
      setSettingsMessage(null);
      return;
    }

    setSavingSettings(true);
    setSettingsError(null);
    setSettingsMessage(null);

    try {
      const titleRes = await saveSiteTitle(cleanTitle);
      if (!titleRes.success) {
        throw new Error(titleRes.message || 'Failed to save site title.');
      }

      const themeRes = await saveTheme(theme);
      if (!themeRes.success) {
        throw new Error(themeRes.message || 'Failed to save theme.');
      }

      document.documentElement.setAttribute('data-theme', theme);
      window.dispatchEvent(new CustomEvent('ptm:site-config-updated', {
        detail: { site_title: cleanTitle, theme },
      }));
      setSettingsMessage('Site settings updated successfully.');
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Failed to save settings.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSaveIntegrationSection = async (sectionName: IntegrationSection) => {
    const keys = Object.keys(integrationMeta[sectionName] || {});
    if (keys.length === 0) return;

    const payload: Record<string, string> = {};
    keys.forEach((key) => {
      payload[key] = integrationValues[key] ?? '';
    });

    setIntegrationSaving(sectionName);
    setIntegrationMessage(null);
    setIntegrationError(null);

    try {
      const res = await saveIntegrationSectionSettings(payload);
      if (!res.success) throw new Error(res.message || 'Failed to save integration settings');
      setIntegrationMessage(res.message || 'Integration settings saved.');
      await loadAdmin();
    } catch (e) {
      setIntegrationError(e instanceof Error ? e.message : 'Failed to save integration settings');
    } finally {
      setIntegrationSaving(null);
    }
  };

  if (loading) {
    return (
      <main className="pt-24 px-4 min-h-screen bg-[#141414] text-white flex items-center justify-center">
        <div className="text-lg text-[#ff6a00] animate-pulse">Loading admin...</div>
      </main>
    );
  }

  if (user?.role !== 0) {
    return (
      <main className="pt-24 px-4 min-h-screen bg-[#141414] text-white flex items-center justify-center">
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-6 py-4 text-red-300">Admin access required.</div>
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
        <header className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight">Admin</h1>
            <p className="text-white/70 mt-1">Manage users, site settings, and Plex sync status.</p>
          </div>
          <a href="/account" className="rounded-lg bg-white/10 px-4 py-2 font-semibold text-white hover:bg-white/20 transition">Back to Account</a>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <aside className="lg:col-span-3 lg:sticky lg:top-28 lg:self-start">
            <div className="rounded-2xl border border-white/10 bg-black/45 backdrop-blur-sm p-3">
              <nav className="flex flex-col gap-2" aria-label="Admin sections">
                <button className={`text-left rounded-xl px-4 py-3 font-semibold transition ${section === 'users' ? 'bg-[#ff6a00] text-white' : 'bg-white/5 text-white/85 hover:bg-white/10'}`} onClick={() => setSection('users')}>User Management</button>
                <button className={`text-left rounded-xl px-4 py-3 font-semibold transition ${section === 'site' ? 'bg-[#ff6a00] text-white' : 'bg-white/5 text-white/85 hover:bg-white/10'}`} onClick={() => setSection('site')}>Site Settings</button>
                <button className={`text-left rounded-xl px-4 py-3 font-semibold transition ${section === 'plex-users' ? 'bg-[#ff6a00] text-white' : 'bg-white/5 text-white/85 hover:bg-white/10'}`} onClick={() => setSection('plex-users')}>Plex Users</button>
              </nav>
            </div>
          </aside>

          <section className="rounded-2xl border border-white/10 bg-black/45 backdrop-blur-sm p-6 md:p-8 shadow-2xl lg:col-span-9">
            {settingsMessage && <div className="mb-3 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-300">{settingsMessage}</div>}
            {settingsError && <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{settingsError}</div>}

            {section === 'users' && (
              <div className="overflow-x-auto rounded-xl border border-white/10 bg-white/5">
                {adminLoadError && <div className="p-3 text-sm text-red-300 border-b border-white/10">{adminLoadError}</div>}
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-white/70 border-b border-white/10">
                      <th className="p-3">ID</th>
                      <th className="p-3">Email</th>
                      <th className="p-3">Plex Username</th>
                      <th className="p-3">Joined</th>
                      <th className="p-3">Plex Joined</th>
                      <th className="p-3">Subscription</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Role</th>
                      <th className="p-3">Manage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminUsers.map((entry) => (
                      <tr key={entry.user.id} className="border-b border-white/10">
                        <td className="p-3">{entry.user.id}</td>
                        <td className="p-3">{entry.user.email || '-'}</td>
                        <td className="p-3">
                          <button className="text-[#ff944d] hover:underline" onClick={() => handleOpenSummary(entry)}>{entry.user.username || '-'}</button>
                        </td>
                        <td className="p-3">{entry.user.created_at ? new Date(entry.user.created_at).toLocaleDateString() : '-'}</td>
                        <td className="p-3">{entry.plex_joined_at ? new Date(entry.plex_joined_at).toLocaleDateString() : '-'}</td>
                        <td className="p-3">{entry.sub_status}</td>
                        <td className="p-3">{entry.user.active ? 'Enabled' : 'Disabled'}</td>
                        <td className="p-3">{roleLabel(entry.user.role)}</td>
                        <td className="p-3">
                          <button className="rounded bg-[#ff6a00] px-3 py-1 text-xs font-semibold hover:bg-orange-500 transition" onClick={() => openManageModal(entry)}>Manage</button>
                        </td>
                      </tr>
                    ))}
                    {adminUsers.length === 0 && (
                      <tr>
                        <td className="p-3 text-white/60" colSpan={9}>No users found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {section === 'site' && (
              <div className="space-y-4">
                <form className="rounded-xl border border-white/10 bg-white/5 p-6 flex flex-col gap-4 max-w-xl" onSubmit={handleSaveSiteSettings}>
                  <label className="flex flex-col gap-1">
                    <span className="font-semibold">Site Title</span>
                    <input className="bg-black/40 border border-white/20 rounded px-3 py-2 text-white" value={siteTitle} onChange={(event) => setSiteTitle(event.target.value)} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="font-semibold">Theme</span>
                    <select className="bg-black/40 border border-white/20 rounded px-3 py-2 text-white" value={theme} onChange={(event) => setThemeValue(event.target.value)}>
                      {themeOptions.map((option) => (
                        <option key={option.key} value={option.key}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <button type="submit" disabled={savingSettings} className="bg-[#ff6a00] text-white rounded px-4 py-2 font-semibold hover:bg-orange-500 transition self-start disabled:opacity-60">
                    {savingSettings ? 'Saving...' : 'Save'}
                  </button>
                </form>

                {(['plex', 'tautulli', 'stripe'] as IntegrationSection[]).map((key) => (
                  <div key={key} className="rounded-xl border border-white/10 bg-white/5 p-6">
                    <h3 className="text-lg font-bold capitalize mb-3">{key} Settings</h3>
                    <div className="grid gap-3">
                      {Object.entries(integrationMeta[key] || {}).map(([fieldKey, field]) => (
                        <label key={fieldKey} className="flex flex-col gap-1">
                          <span className="font-semibold text-sm">{fieldKey}</span>
                          <input
                            type={field.is_secret ? 'password' : 'text'}
                            className="bg-black/40 border border-white/20 rounded px-3 py-2 text-white"
                            value={integrationValues[fieldKey] ?? ''}
                            onChange={(event) => setIntegrationValues((prev) => ({ ...prev, [fieldKey]: event.target.value }))}
                            placeholder={field.is_secret && field.has_value ? '••••••••••' : ''}
                          />
                        </label>
                      ))}
                    </div>
                    <button onClick={() => handleSaveIntegrationSection(key)} disabled={integrationSaving === key} className="mt-4 bg-[#ff6a00] text-white rounded px-4 py-2 text-sm font-semibold hover:bg-orange-500 transition disabled:opacity-60">
                      {integrationSaving === key ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                ))}
                {integrationMessage && <div className="text-sm text-green-300">{integrationMessage}</div>}
                {integrationError && <div className="text-sm text-red-300">{integrationError}</div>}
              </div>
            )}

            {section === 'plex-users' && (
              <div className="overflow-x-auto rounded-xl border border-white/10 bg-white/5">
                {adminLoadError && <div className="p-3 text-sm text-red-300 border-b border-white/10">{adminLoadError}</div>}
                {plexError && <div className="p-3 text-sm text-red-300 border-b border-white/10">{plexError}</div>}
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-white/70 border-b border-white/10">
                      <th className="p-3">Name</th>
                      <th className="p-3">Email</th>
                      <th className="p-3">Plex ID</th>
                      <th className="p-3">Member?</th>
                      <th className="p-3">Plex Join Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plexUsers.map((u, i) => (
                      <tr key={i} className="border-b border-white/10">
                        <td className="p-3">{u.name}</td>
                        <td className="p-3">{u.email || '-'}</td>
                        <td className="p-3">{u.plex_id || '-'}</td>
                        <td className="p-3">{u.is_member ? 'Yes' : 'No'}</td>
                        <td className="p-3">{u.plex_joined_at ? new Date(u.plex_joined_at).toLocaleDateString() : '-'}</td>
                      </tr>
                    ))}
                    {plexUsers.length === 0 && !plexError && (
                      <tr>
                        <td className="p-3 text-white/60" colSpan={5}>No Plex users found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        {summaryHtml && (
          <div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4" onClick={() => setSummaryHtml(null)}>
            <div className="max-w-2xl w-full rounded-xl border border-white/10 bg-[#121212] p-6" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xl font-bold">{summaryTitle}</h3>
                <button className="text-white/70 hover:text-white" onClick={() => setSummaryHtml(null)}>Close</button>
              </div>
              <div className="text-sm text-white/80 max-h-[60vh] overflow-auto" dangerouslySetInnerHTML={{ __html: summaryHtml }} />
            </div>
          </div>
        )}

        {managingEntry && (
          <div className="fixed inset-0 z-[110] bg-black/70 flex items-center justify-center p-4" onClick={closeManageModal}>
            <div className="max-w-2xl w-full rounded-xl border border-white/10 bg-[#121212] p-6" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold">Manage User</h3>
                <button className="text-white/70 hover:text-white" onClick={closeManageModal}>Close</button>
              </div>
              <p className="text-white/70 mb-4">{managingEntry.user.email || managingEntry.user.username || `User #${managingEntry.user.id}`}</p>

              {manageMessage && <div className="mb-3 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-300">{manageMessage}</div>}
              {manageError && <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{manageError}</div>}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-semibold">Status</span>
                  <select className="bg-black/40 border border-white/20 rounded px-3 py-2" value={manageActive} onChange={(e) => setManageActive(e.target.value)} disabled={user?.id === managingEntry.user.id}>
                    <option value="1">Enabled</option>
                    <option value="0">Disabled</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-semibold">Role</span>
                  <select className="bg-black/40 border border-white/20 rounded px-3 py-2" value={manageRole} onChange={(e) => setManageRole(e.target.value)} disabled={user?.id === managingEntry.user.id}>
                    <option value="0">Admin</option>
                    <option value="1">Power User</option>
                    <option value="2">Member</option>
                  </select>
                </label>
              </div>
              <button className="rounded bg-[#ff6a00] px-4 py-2 text-sm font-semibold hover:bg-orange-500 transition disabled:opacity-60 mb-6" disabled={user?.id === managingEntry.user.id || manageBusy === 'save'} onClick={handleUserSave}>
                {manageBusy === 'save' ? 'Saving...' : 'Save Account Changes'}
              </button>

              <div className="border-t border-white/10 pt-4 mb-4">
                <h4 className="font-semibold mb-3">Assign Plan</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                  <select className="bg-black/40 border border-white/20 rounded px-3 py-2" value={planTier} onChange={(e) => setPlanTier(e.target.value)}>
                    <option value="basic">Basic</option>
                    <option value="standard">Standard</option>
                    <option value="premium">Premium</option>
                  </select>
                  <input className="bg-black/40 border border-white/20 rounded px-3 py-2" type="date" value={planStartDate} onChange={(e) => setPlanStartDate(e.target.value)} />
                  <input className="bg-black/40 border border-white/20 rounded px-3 py-2" type="date" value={planEndDate} onChange={(e) => setPlanEndDate(e.target.value)} />
                </div>
                <button className="rounded bg-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/25 transition disabled:opacity-60" disabled={manageBusy === 'plan'} onClick={handleAssignPlan}>
                  {manageBusy === 'plan' ? 'Assigning...' : 'Assign Plan'}
                </button>
              </div>

              <div className="border-t border-white/10 pt-4 mb-4">
                <h4 className="font-semibold mb-3">Password</h4>
                <div className="flex flex-col md:flex-row gap-3">
                  <input className="flex-1 bg-black/40 border border-white/20 rounded px-3 py-2" type="password" placeholder="New password" value={managePassword} onChange={(e) => setManagePassword(e.target.value)} />
                  <button className="rounded bg-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/25 transition disabled:opacity-60" disabled={manageBusy === 'password'} onClick={handleChangePassword}>
                    {manageBusy === 'password' ? 'Saving...' : 'Set Password'}
                  </button>
                </div>
              </div>

              {user?.id !== managingEntry.user.id && (
                <div className="border-t border-white/10 pt-4 flex flex-wrap gap-2">
                  <button className="rounded bg-white/15 px-3 py-2 text-sm font-semibold hover:bg-white/25 transition disabled:opacity-60" disabled={manageBusy === 'unlink'} onClick={handleUnlinkPlex}>
                    {manageBusy === 'unlink' ? 'Working...' : 'Unlink Plex'}
                  </button>
                  <button className="rounded bg-red-600/80 px-3 py-2 text-sm font-semibold hover:bg-red-500 transition disabled:opacity-60" disabled={manageBusy === 'delete'} onClick={handleDeleteUser}>
                    {manageBusy === 'delete' ? 'Deleting...' : 'Delete User'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
};

export default Admin;
