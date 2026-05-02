export interface Subscription {
  id: number;
  user_id: number;
  tier: string;
  active: boolean;
  start_date?: string;
  end_date?: string;
  stripe_subscription_id?: string;
  payment_status?: string;
  last_payment_date?: string;
  renewal: boolean;
  notes?: string;
}

export interface User {
  id: number;
  email?: string;
  plex_id?: string;
  username?: string;
  role: 0 | 1 | 2;
  created_at?: string;
  active: boolean;
  subscriptions?: Subscription[];
}
