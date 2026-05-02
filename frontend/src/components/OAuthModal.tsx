import React, { useState } from 'react';

import { fetchAuthStatus, plexSimpleLogin } from '../api';

interface OAuthModalProps {
  provider: 'plex' | 'google';
  onClose: () => void;
}

const OAuthModal: React.FC<OAuthModalProps> = ({ provider, onClose }) => {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'oauth' | 'simple'>(null);

  const redirectIfAuthed = async () => {
    const auth = await fetchAuthStatus();
    if (auth.authenticated) {
      window.location.href = '/account';
      return true;
    }
    return false;
  };

  const handlePlexPopup = async () => {
    setError(null);
    setMessage(null);
    setBusy('oauth');

    const popup = window.open(
      '/login/plex',
      'plexLogin',
      'width=500,height=650,scrollbars=yes,resizable=yes,menubar=no,toolbar=no,location=no,status=no',
    );

    if (!popup || popup.closed || typeof popup.closed === 'undefined') {
      setBusy(null);
      setError('Popup was blocked. Allow popups and try again, or use local Plex login.');
      return;
    }

    setMessage('Complete login in the popup. This window will continue automatically.');

    const startedAt = Date.now();
    const timeoutMs = 6 * 60 * 1000;

    const timer = window.setInterval(async () => {
      if (!popup || popup.closed) {
        window.clearInterval(timer);
        try {
          const authed = await redirectIfAuthed();
          if (!authed) {
            setError('Plex login was canceled or did not complete.');
          }
        } catch {
          setError('Could not verify login status. Please refresh and try again.');
        } finally {
          setBusy(null);
        }
        return;
      }

      if (Date.now() - startedAt > timeoutMs) {
        window.clearInterval(timer);
        popup.close();
        setBusy(null);
        setError('Plex login timed out. Please try again.');
      }
    }, 1000);
  };

  const handlePlexSimple = async () => {
    setError(null);
    setMessage(null);
    setBusy('simple');
    try {
      const data = await plexSimpleLogin();
      if (data.success) {
        window.location.href = '/account';
        return;
      }
      setError(data.message || 'Simple Plex login failed.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Simple Plex login failed.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-xl p-8 shadow-2xl w-full max-w-md relative border border-white/10">
        <button
          className="absolute top-4 right-4 text-gray-400 hover:text-white"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
        <h2 className="text-2xl font-bold text-netflix-orange mb-4">
          {provider === 'plex' ? 'Sign in with Plex' : 'Sign in with Google'}
        </h2>

        {provider === 'plex' ? (
          <div className="flex flex-col gap-3">
            {message && <div className="rounded border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-300">{message}</div>}
            {error && <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

            <button
              className="bg-[#ff6a00] hover:bg-orange-500 text-white font-semibold py-3 px-6 rounded transition disabled:opacity-60"
              onClick={handlePlexPopup}
              disabled={busy !== null}
            >
              {busy === 'oauth' ? 'Waiting for Plex...' : 'Continue with Plex'}
            </button>
            <button
              className="bg-white/10 border border-white/20 text-white py-3 px-6 rounded hover:bg-white/20 transition disabled:opacity-60"
              onClick={handlePlexSimple}
              disabled={busy !== null}
            >
              {busy === 'simple' ? 'Signing in...' : 'Local Network Quick Login'}
            </button>
            <p className="text-xs text-white/60">Quick login works only on local network and when Plex token is configured.</p>
          </div>
        ) : (
          <div className="rounded border border-white/15 bg-white/5 px-4 py-3 text-sm text-white/70">
            Google sign-in is not configured yet. Please use Email or Plex login.
          </div>
        )}
      </div>
    </div>
  );
};

export default OAuthModal;
