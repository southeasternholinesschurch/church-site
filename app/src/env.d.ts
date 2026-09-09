/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

type Runtime = import('@astrojs/cloudflare').Runtime<Env>;

interface Env {
  DB: D1Database;
  PHOTOS?: R2Bucket;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /* Twilio — Worker secrets, never in the repo and never sent to a browser. */
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_API_KEY_SID?: string;
  TWILIO_API_KEY_SECRET?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
  TWILIO_MESSAGING_SERVICE_SID?: string;
  /* Shared secret the reminder cron Worker presents. */
  SMS_CRON_SECRET?: string;
  /* Google service account for the reminder sheet. */
  /** Published-CSV URL of the singing schedule. */
  REMINDER_SHEET_CSV_URL?: string;
  /** Cloudflare deploy hook. The URL itself is the credential — server-side only. */
  DEPLOY_HOOK_URL?: string;
  /**
   * "1" on the PUBLIC DEMO deployment only.
   *
   * Set as a plain var in wrangler.demo.jsonc, never on the real app. It does
   * two things: lets anyone in without signing in, and makes sending a text
   * impossible. Both are checked at the point of action, not in the UI — a
   * hidden button is not a disabled one.
   */
  DEMO_INSTANCE?: string;
  /**
   * Which role the demo user wears. Only read when DEMO_INSTANCE is '1'.
   *
   * A LOCAL TESTING AFFORDANCE: it is how the Fairhaven Kids permission gate is
   * verified without a Google sign-in — DEMO_ROLE=kids in .dev.vars and the
   * app behaves as it does for a volunteer. Unset, or anything unrecognised,
   * means admin, which is what the public demo needs.
   */
  DEMO_ROLE?: string;
}

declare namespace App {
  interface Locals extends Runtime {
    user?: import('./lib/session').SessionUser;
    /**
     * The check-in kiosk, when the request came from a paired tablet.
     *
     * A SEPARATE field from `user` on purpose, and the two are never both set.
     * Every page in this app reads `locals.user` and assumes a trusted human;
     * a kiosk must never satisfy that read. See lib/kiosk.ts.
     */
    kiosk?: import('./lib/kiosk').KioskDevice;
  }
}
