import { Play } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { plexStartUrl } from "../api";
import { useSession } from "../session";
import { linkButton, Notice } from "../ui";

export const SIGNIN_ERRORS: Record<string, string> = {
  expired: "That sign-in took too long or was opened in another browser. Please try again.",
  cancelled: "Sign-in was cancelled, or Plex didn't confirm it. Please try again.",
  plex: "Plex sign-in didn't work. Please try again in a moment.",
  signups_closed: "New sign-ups are closed right now.",
  disabled: "This account has been disabled. Contact support if you think that's a mistake.",
};

export function PlexButton({ next, className = "w-full py-3" }: { next?: string; className?: string }) {
  return (
    <a href={plexStartUrl({ returnTo: next })} className={linkButton("plex", className)}>
      <Play className="size-4 fill-current" /> Continue with Plex
    </a>
  );
}

export function SignIn() {
  const [params] = useSearchParams();
  const { config, me } = useSession();
  const error = params.get("error");
  const next = params.get("next") || undefined;
  if (me) return (
    <div className="mx-auto max-w-md py-6"><div className="card p-6 sm:p-8">
      <h1 className="text-2xl font-semibold text-white">You're signed in</h1>
      <Link className="mt-3 inline-block text-plex" to="/">Go to your home page →</Link>
    </div></div>
  );
  return (
    <div className="mx-auto max-w-md py-6">
      <div className="card p-6 sm:p-8">
        <h1 className="text-2xl font-semibold text-white">Sign in to {config?.site_name}</h1>
        <p className="mt-1.5 text-sm text-zinc-400">Use your Plex account. New here? Signing in creates your account. You choose a plan after.</p>
        <div className="mt-6 space-y-4">
          {error && <Notice tone="error">{SIGNIN_ERRORS[error] ?? "Sign-in didn't work. Please try again."}</Notice>}
          <PlexButton next={next} />
          <p className="text-xs leading-relaxed text-zinc-500">You'll approve the sign-in on plex.tv. We only read your Plex username, email and
            picture; we never see your Plex password.</p>
        </div>
      </div>
    </div>
  );
}
