#!/usr/bin/env node
/**
 * One-time consent, to get the refresh token the transcript importer needs.
 *
 *   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node scripts/youtube-auth.mjs
 *
 * Run it once, on a machine with a browser, signed in as the account that OWNS
 * the YouTube channel. It prints a refresh token. Put that in the repo secrets
 * as GOOGLE_REFRESH_TOKEN and never run this again — refresh tokens do not
 * expire unless they are revoked or unused for six months.
 *
 * It listens on localhost only, for one request, and exits. Nothing is stored
 * on disk: the token is printed once so it goes where you choose to put it.
 */
import http from 'node:http';
import { exec } from 'node:child_process';

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first.');
  console.error('Google Cloud Console -> Credentials -> Create OAuth client ID -> Desktop app');
  process.exit(1);
}

const PORT = Number(process.env.OAUTH_PORT) || 8787;
/**
 * No path, and localhost rather than 127.0.0.1, to match what a Desktop client
 * registers by default ("http://localhost"). Google allows any PORT on the
 * loopback address for desktop clients, but is fussier about the path — so
 * there isn't one, and the server answers whatever it is given.
 */
const REDIRECT = `http://localhost:${PORT}`;
/** force-ssl is the scope captions.download requires. Nothing broader. */
const SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';

const consent = new URL('https://accounts.google.com/o/oauth2/v2/auth');
consent.search = new URLSearchParams({
  client_id: GOOGLE_CLIENT_ID,
  redirect_uri: REDIRECT,
  response_type: 'code',
  scope: SCOPE,
  // Both are required to be GIVEN a refresh token rather than only an access one.
  access_type: 'offline',
  prompt: 'consent',
}).toString();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/favicon.ico') { res.writeHead(404).end(); return; }

  const code = url.searchParams.get('code');
  const denied = url.searchParams.get('error');
  if (denied || !code) {
    res.writeHead(200, { 'content-type': 'text/html' })
       .end(`<p>Consent was not granted (${denied ?? 'no code'}). Nothing has changed.</p>`);
    console.error('\nConsent denied.'); server.close(); process.exit(1);
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: REDIRECT, grant_type: 'authorization_code',
    }),
  });
  const body = await tokenRes.json();

  if (!tokenRes.ok || !body.refresh_token) {
    res.writeHead(200, { 'content-type': 'text/html' })
       .end('<p>Something went wrong. Check the terminal.</p>');
    console.error('\nNo refresh token returned:', JSON.stringify(body, null, 2));
    console.error('\nIf this says the app is already authorised, revoke it at');
    console.error('https://myaccount.google.com/permissions and run this again.');
    server.close(); process.exit(1);
  }

  res.writeHead(200, { 'content-type': 'text/html' })
     .end('<p>Done. The refresh token is in your terminal — you can close this tab.</p>');
  console.log('\n──────── GOOGLE_REFRESH_TOKEN ────────');
  console.log(body.refresh_token);
  console.log('──────────────────────────────────────');
  console.log('\nAdd it to the repo secrets. Treat it like a password: it grants');
  console.log('access to the channel until it is revoked.');
  server.close(); process.exit(0);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Listening on ${REDIRECT}`);
  console.log('\nIf a browser does not open, visit this yourself:\n');
  console.log(consent.href + '\n');
  exec(`open "${consent.href}"`);
});
