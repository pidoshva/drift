export interface Env {
  DB: D1Database;
  SITE_URL: string;
  DEALER_NAME: string;
  TELEGRAM_CHAT_ID: string;
  CONTACT_EMAIL: string;
  CONTACT_FROM_EMAIL: string;
  CONTACT_METHODS: string; // "telegram,email"
  IP_MODE: string;         // "hash" | "full"
  // secrets
  TELEGRAM_BOT_TOKEN?: string;
  RESEND_API_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  ADMIN_TOKEN?: string;
  DASHBOARD_TOKEN?: string;
  // test/dev overrides
  TELEGRAM_API_BASE?: string;
  RESEND_API_BASE?: string;
  TURNSTILE_API_BASE?: string;
}

export interface PublicListing {
  id: string; title: string; price: number | null; photo: string | null; url: string; path: string; status: string;
}

export interface LeadInput {
  name: string; phone: string; email: string; message: string; listingId: string; page: string; sid: string;
}

export const VERSION = '0.1.0';
