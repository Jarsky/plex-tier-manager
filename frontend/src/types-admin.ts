import type { User } from './types';

export interface AdminUserEntry {
  user: User;
  sub_status: string;
  plex_joined_at?: string;
}

export interface PlexUser {
  name: string;
  email?: string;
  plex_id?: string;
  is_member: boolean;
  plex_joined_at?: string;
}

export interface SiteSetting {
  key: string;
  value: string;
}
