/**
 * Wakes the staff app hourly so it can decide whether the Monday singing
 * reminder is due.
 *
 * A separate Worker rather than a scheduled() handler inside the app, for the
 * same reason rebuild-cron exists: the app's Worker entry point is GENERATED
 * by the Astro adapter, so adding a handler to it means wrapping generated
 * code that changes on every build. This does one thing and stays out of the
 * way. It holds no Twilio credentials and no member data — it knows a URL and
 * a shared secret, nothing else.
 */
export interface Env {
  APP_URL: string;          // https://app.example.org
  SMS_CRON_SECRET: string;  // must match the app's secret of the same name
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // Both triggers run the queue; only the hourly one also does the roster,
    // which costs a fetch to Google Sheets.
    ctx.waitUntil(run(env, event.cron === '0 * * * *'));
  },
  /** Manual trigger for testing: GET with the secret. Never sends on its own
   *  outside a window — the app makes that decision, not this. */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const given = url.searchParams.get('secret') ?? '';
    if (given !== env.SMS_CRON_SECRET) return new Response('unauthorised', { status: 401 });
    return new Response(await run(env, url.searchParams.get('roster') === '1'),
                        { headers: { 'content-type': 'application/json' } });
  },
};

async function run(env: Env, roster = false): Promise<string> {
  try {
    const res = await fetch(`${env.APP_URL}/api/sms/run-due${roster ? '?roster=1' : ''}`, {
      method: 'POST',
      headers: { 'x-cron-secret': env.SMS_CRON_SECRET },
    });
    const text = await res.text();
    // Logged rather than thrown: a failure here must not retry blindly, since
    // the app is the thing that knows what has already been sent.
    console.log(`run-due -> ${res.status} ${text.slice(0, 300)}`);
    return text;
  } catch (err) {
    console.error('run-due unreachable', err);
    return JSON.stringify({ error: String(err) });
  }
}
