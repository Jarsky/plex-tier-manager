import { useState } from "react";
import { api } from "../../api";
import { useSession } from "../../session";
import { Button, Card, errorText, Field, Notice, Spinner, Toggle, useToast } from "../../ui";
import { SecretInput, useSettings } from "./common";

function Header({ title, text }: { title: string; text: string }) {
  return <div><h2 className="text-2xl font-semibold text-white">{title}</h2><p className="mt-1 text-sm text-zinc-400">{text}</p></div>;
}

export function EmailSettings() {
  const { settings, setSettings, save, saving } = useSettings();
  const { me } = useSession();
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [testTo, setTestTo] = useState(me?.email ?? "");
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState("");
  if (!settings) return <Spinner />;
  const set = (k: string) => (v: any) => setSettings({ ...settings, [k]: v });
  const submit = () => save({
    smtp_host: settings.smtp_host, smtp_port: settings.smtp_port, smtp_username: settings.smtp_username,
    smtp_from: settings.smtp_from, smtp_security: settings.smtp_security, ...(password ? { smtp_password: password } : {}),
  }).then((ok) => ok && setPassword(""));
  const test = async () => {
    setTesting(true); setTestError("");
    try { await api("/admin/settings/test-email", { body: { to: testTo } }); toast(`Test email sent to ${testTo}`); }
    catch (e) { setTestError(errorText(e)); } finally { setTesting(false); }
  };
  return (
    <div className="space-y-6">
      <Header title="Email" text="Used for support replies and notifications." />
      <Card title="SMTP server">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Host"><input className="input" value={settings.smtp_host} onChange={(e) => set("smtp_host")(e.target.value)} placeholder="smtp.example.com" /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Port"><input className="input" inputMode="numeric" value={settings.smtp_port} onChange={(e) => set("smtp_port")(e.target.value.replace(/\D/g, ""))} /></Field>
            <Field label="Security">
              <select className="input" value={settings.smtp_security} onChange={(e) => set("smtp_security")(e.target.value)}>
                <option value="starttls">STARTTLS</option><option value="ssl">SSL/TLS</option><option value="none">None</option>
              </select>
            </Field>
          </div>
          <Field label="Username"><input className="input" autoComplete="off" value={settings.smtp_username} onChange={(e) => set("smtp_username")(e.target.value)} /></Field>
          <Field label="Password"><SecretInput isSet={settings.smtp_password} value={password} onChange={setPassword} /></Field>
          <div className="sm:col-span-2"><Field label="From address" hint='e.g. "My Plex <noreply@example.com>"'>
            <input className="input" value={settings.smtp_from} onChange={(e) => set("smtp_from")(e.target.value)} /></Field></div>
        </div>
        <Button variant="primary" className="mt-6" loading={saving} onClick={submit}>Save</Button>
      </Card>
      <Card title="Send a test email">
        <div className="flex gap-3">
          <input className="input" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" />
          <Button loading={testing} disabled={!testTo} onClick={test}>Send</Button>
        </div>
        {testError && <div className="mt-3"><Notice tone="error">{testError}</Notice></div>}
      </Card>
    </div>
  );
}

export function SiteSettings() {
  const { settings, setSettings, save, saving } = useSettings();
  if (!settings) return <Spinner />;
  const set = (k: string) => (v: any) => setSettings({ ...settings, [k]: v });
  const num = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => set(k)(e.target.value.replace(/\D/g, ""));
  return (
    <div className="space-y-6">
      <Header title="Site" text="Branding, sign-ups and record keeping." />
      <Card title="Branding">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Site name" hint="Also shown on plex.tv when people approve sign-in."><input className="input" value={settings.site_name} maxLength={60} onChange={(e) => set("site_name")(e.target.value)} /></Field>
          <Field label="Tagline" hint="Two short sentences work best on the home page."><input className="input" value={settings.site_tagline} maxLength={120} onChange={(e) => set("site_tagline")(e.target.value)} /></Field>
        </div>
      </Card>
      <Card title="Accounts">
        <Toggle checked={settings.signup_open} onChange={set("signup_open")} label="Allow new sign-ups" hint="When off, only existing members can sign in." />
      </Card>
      <Card title="Records">
        <div className="max-w-xs"><Field label="Keep the audit log for (days)" hint="0 = forever. Older entries are removed when the app starts and when you open the log.">
          <input className="input" inputMode="numeric" value={settings.audit_retention_days} onChange={num("audit_retention_days")} /></Field></div>
      </Card>
      <Button variant="primary" loading={saving} onClick={() => save({
        site_name: settings.site_name, site_tagline: settings.site_tagline, signup_open: settings.signup_open,
        audit_retention_days: Number(settings.audit_retention_days) || 0,
      })}>Save changes</Button>
    </div>
  );
}
