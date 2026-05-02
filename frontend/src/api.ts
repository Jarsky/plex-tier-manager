import type { User, Subscription } from './types';
import type { AdminUserEntry, PlexUser } from './types-admin';

const API_BASE = '/api';

async function parseApiResponse(res: Response): Promise<any> {
  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();
  if (!text) {
    throw new Error(`Empty response from ${res.url}`);
  }

  if (!contentType.includes('application/json')) {
    if (res.redirected) {
      throw new Error('Session expired. Please sign in again.');
    }
    throw new Error(`Unexpected response from ${res.url} (${res.status})`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON response from ${res.url}`);
  }
}

async function getCsrfToken(): Promise<string> {
  const csrfRes = await fetch(`${API_BASE}/csrf-token`, { credentials: 'include' });
  if (!csrfRes.ok) {
    throw new Error('Failed to fetch CSRF token');
  }
  const csrfData = await parseApiResponse(csrfRes);
  if (!csrfData.csrf_token) {
    throw new Error('CSRF token missing from response');
  }
  return csrfData.csrf_token;
}

interface ApiResponse {
  success?: boolean;
  message?: string;
  error?: string;
}

export interface ThemeOption {
  key: string;
  label: string;
}

export interface SiteConfig {
  site_title: string;
  theme: string;
  theme_options: ThemeOption[];
}

export interface AuthStatus {
  authenticated: boolean;
  user?: User;
}

export interface IntegrationField {
  is_secret: boolean;
  has_value: boolean;
  value: string;
}

export interface AdminSiteSettings extends SiteConfig {
  integrations: Record<string, Record<string, IntegrationField>>;
}

export async function fetchDashboardData(): Promise<{ user: User; subscriptions: Subscription[] }> {
  const res = await fetch(`${API_BASE}/dashboard`, { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to fetch dashboard data');
  return parseApiResponse(res);
}

export async function fetchAuthStatus(): Promise<AuthStatus> {
  const res = await fetch(`${API_BASE}/auth/status`, { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to fetch auth status');
  return parseApiResponse(res);
}

export async function fetchSiteConfig(): Promise<SiteConfig> {
  const res = await fetch(`${API_BASE}/site-config`, { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to fetch site config');
  return parseApiResponse(res);
}

export async function fetchAdminUsers(): Promise<AdminUserEntry[]> {
  const res = await fetch('/admin/api/users', { credentials: 'include' });
  if (!res.ok) throw new Error(`Failed to fetch admin users (${res.status})`);
  const data = await parseApiResponse(res);
  return data.users ?? [];
}

export async function fetchPlexUsers(): Promise<PlexUser[]> {
  const res = await fetch('/admin/api/plex_users', { credentials: 'include' });
  const data = await parseApiResponse(res);
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Failed to fetch Plex users');
  }

  return (data.users ?? []).map((u: any) => ({
    name: u.name,
    email: u.email,
    plex_id: u.plex_id,
    is_member: Boolean(u.is_member),
    plex_joined_at: u.joined_at,
  }));
}

export async function fetchAdminSiteSettings(): Promise<AdminSiteSettings> {
  const res = await fetch('/admin/api/site_settings', { credentials: 'include' });
  const data = await parseApiResponse(res);
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Failed to fetch site settings');
  }

  return {
    site_title: data.site_title,
    theme: data.theme,
    theme_options: data.theme_options ?? [],
    integrations: data.integrations ?? {},
  };
}

async function postAdminJson(url: string, payload: Record<string, unknown>): Promise<ApiResponse> {
  const csrfToken = await getCsrfToken();
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': csrfToken,
    },
    body: JSON.stringify(payload),
  });
  return parseApiResponse(res);
}

export async function saveAdminUser(userId: number, role: number, active: boolean): Promise<ApiResponse> {
  return postAdminJson('/admin/save_user', {
    user_id: userId,
    role,
    active: active ? 1 : 0,
  });
}

export async function deleteAdminUser(userId: number): Promise<ApiResponse> {
  return postAdminJson('/admin/delete_user', { user_id: userId });
}

export async function unlinkAdminPlex(userId: number): Promise<ApiResponse> {
  return postAdminJson('/admin/unlink_plex', { user_id: userId });
}

export async function changeAdminPassword(userId: number, newPassword: string): Promise<ApiResponse> {
  return postAdminJson('/admin/change_password', {
    user_id: userId,
    new_password: newPassword,
  });
}

export async function assignAdminPlan(userId: number, tier: string, startDate: string, endDate?: string): Promise<ApiResponse> {
  return postAdminJson('/admin/assign_plan', {
    user_id: userId,
    tier,
    start_date: startDate,
    end_date: endDate || null,
  });
}

export async function fetchAdminUserSummary(userId: number): Promise<{ success: boolean; html?: string; message?: string }> {
  const data = await postAdminJson('/admin/user_summary', { user_id: userId });
  return {
    success: Boolean(data.success),
    html: (data as any).html,
    message: data.message,
  };
}

export async function saveIntegrationSectionSettings(values: Record<string, string>): Promise<ApiResponse> {
  const csrfToken = await getCsrfToken();
  const body = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => body.append(key, value));

  const res = await fetch('/admin/settings', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-CSRFToken': csrfToken,
    },
    body: body.toString(),
  });
  return parseApiResponse(res);
}

export async function saveSiteTitle(siteTitle: string): Promise<ApiResponse> {
  const csrfToken = await getCsrfToken();
  const body = new URLSearchParams({ site_title: siteTitle });
  const res = await fetch('/admin/set_site_title', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-CSRFToken': csrfToken,
    },
    body: body.toString(),
  });
  return parseApiResponse(res);
}

export async function saveTheme(theme: string): Promise<ApiResponse> {
  const csrfToken = await getCsrfToken();
  const body = new URLSearchParams({ theme });
  const res = await fetch('/admin/set_theme', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-CSRFToken': csrfToken,
    },
    body: body.toString(),
  });
  return parseApiResponse(res);
}

export async function signupUser(email: string, password?: string): Promise<ApiResponse & { generated_password?: string }> {
  const csrfToken = await getCsrfToken();
  const body = new URLSearchParams({ email });
  if (password) {
    body.set('password', password);
  }

  const res = await fetch('/signup', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-CSRFToken': csrfToken,
    },
    body: body.toString(),
  });
  return parseApiResponse(res);
}

export async function changeUserPassword(newPassword: string, confirmPassword: string): Promise<ApiResponse> {
  const csrfToken = await getCsrfToken();
  const body = new URLSearchParams({
    new_password: newPassword,
    confirm_password: confirmPassword,
  });

  const res = await fetch('/user/change_password', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-CSRFToken': csrfToken,
    },
    body: body.toString(),
  });
  return parseApiResponse(res);
}

export async function plexSimpleLogin(): Promise<ApiResponse> {
  const res = await fetch('/login/plex/simple', { credentials: 'include' });
  return parseApiResponse(res);
}
