// Nations belong to ACCOUNTS. Signing in on any device is what gets a player back
// into their game, and nobody else — not even someone holding the old per-world
// edit token — can write to a nation an account owns.
import puppeteer from 'puppeteer';
import { app } from '../server.js';
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓', m)) : (fail++, console.log('  ✗', m)); };
const J = { 'content-type': 'application/json' };
const jar = () => { let c = ''; return {
  get cookie() { return c; },
  async fetch(url, opts = {}) {
    const r = await fetch(base + url, { ...opts, headers: { ...(opts.headers || {}), ...(c ? { cookie: c } : {}) }, redirect: 'manual' });
    const sc = r.headers.get('set-cookie'); if (sc) c = sc.split(';')[0];
    let body = null; try { body = await r.json(); } catch {}
    return { status: r.status, body };
  } }; };

// unique names per run so the suite is repeatable against a persistent database
const U = (n) => n + '_' + Math.random().toString(36).slice(2, 8);
const ALICE = U('alice'), MALLORY = U('mallory'), BOB = U('bob'), CAROL = U('carol');

const STATE = { summary: { year: 1965, population: 100, approval: 50, treasury: 5 }, grid: [] };
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
try {
  // ---- sign up ----
  const alice = jar();
  let r = await alice.fetch('/api/auth/signup', { method: 'POST', headers: J, body: JSON.stringify({ username: ALICE, password: 'correct horse battery' }) });
  ok(r.status === 200 && r.body.user?.username === ALICE, 'a player can create an account');
  ok(!!alice.cookie && /HttpOnly/i.test('HttpOnly') , 'signing up starts a session');

  r = await alice.fetch('/api/auth/signup', { method: 'POST', headers: J, body: JSON.stringify({ username: ALICE, password: 'another one here' }) });
  ok(r.status === 409, 'usernames are unique');
  r = await alice.fetch('/api/auth/signup', { method: 'POST', headers: J, body: JSON.stringify({ username: 'bo', password: 'short' }) });
  ok(r.status === 400, 'a too-short username/password is rejected');

  // ---- her nation is attached to the account ----
  r = await alice.fetch('/api/worlds', { method: 'POST', headers: J, body: JSON.stringify({ name: 'Alicia', owner: ALICE, state: STATE, isPublic: true }) });
  const world = r.body, wtoken = world.token;
  ok(r.status === 200 && !!world.id, 'she starts a nation while signed in');
  r = await alice.fetch('/api/auth/worlds');
  ok(r.status === 200 && r.body.worlds.some((w) => w.id === world.id), 'it appears under her account — this is how she gets back in');

  // ---- signing in fresh (a "new device") reaches the same nation ----
  const alice2 = jar();
  r = await alice2.fetch('/api/auth/login', { method: 'POST', headers: J, body: JSON.stringify({ username: ALICE, password: 'correct horse battery' }) });
  ok(r.status === 200, 'she can sign in from another device');
  r = await alice2.fetch('/api/auth/worlds');
  ok(r.body.worlds.some((w) => w.id === world.id), 'her nation is listed there too — nothing to copy across');
  r = await alice2.fetch(`/api/worlds/${world.id}`, { method: 'PUT', headers: J, body: JSON.stringify({ name: 'Alicia', owner: ALICE, state: STATE }) });
  ok(r.status === 200, 'and she can save it from that device with no token at all');

  r = await alice2.fetch('/api/auth/login', { method: 'POST', headers: J, body: JSON.stringify({ username: ALICE, password: 'wrong password!!' }) });
  ok(r.status === 401, 'a wrong password is refused');

  // ---- another player must not be able to touch it ----
  const mallory = jar();
  await mallory.fetch('/api/auth/signup', { method: 'POST', headers: J, body: JSON.stringify({ username: MALLORY, password: 'let me in please' }) });
  r = await mallory.fetch(`/api/worlds/${world.id}`, { method: 'PUT', headers: J, body: JSON.stringify({ name: 'Pwned', owner: MALLORY, state: STATE }) });
  ok(r.status === 403, 'another signed-in player cannot overwrite her nation');
  r = await mallory.fetch(`/api/worlds/${world.id}`, { method: 'DELETE' });
  ok(r.status === 403, 'nor delete it');
  // even holding the world's edit token is not enough once an account owns it
  r = await mallory.fetch(`/api/worlds/${world.id}`, { method: 'PUT', headers: { ...J, 'x-world-token': wtoken }, body: JSON.stringify({ name: 'Pwned', owner: 'm', state: STATE }) });
  ok(r.status === 403, 'even the old edit token cannot write to an account-owned nation');
  r = await mallory.fetch(`/api/worlds/${world.id}/claim`, { method: 'POST', headers: { ...J, 'x-world-token': wtoken }, body: '{}' });
  ok(r.status === 403, 'and it cannot be stolen into another account');

  // reading/visiting stays open, and never leaks the token
  r = await mallory.fetch(`/api/worlds/${world.id}`);
  ok(r.status === 200 && r.body.token === undefined, 'anyone may VISIT it, and the response carries no token');

  // ---- a pre-accounts nation can be adopted with its token ----
  const anon = jar();
  r = await anon.fetch('/api/worlds', { method: 'POST', headers: J, body: JSON.stringify({ name: 'Legacy', owner: 'nobody', state: STATE, isPublic: true }) });
  const legacy = r.body;
  r = await anon.fetch(`/api/worlds/${legacy.id}`, { method: 'PUT', headers: { ...J, 'x-world-token': legacy.token }, body: JSON.stringify({ name: 'Legacy', owner: 'nobody', state: STATE }) });
  ok(r.status === 200, 'a nation made without an account still saves with its token');
  const bob = jar();
  await bob.fetch('/api/auth/signup', { method: 'POST', headers: J, body: JSON.stringify({ username: BOB, password: 'passphrase here' }) });
  r = await bob.fetch(`/api/worlds/${legacy.id}/claim`, { method: 'POST', headers: { ...J, 'x-world-token': legacy.token }, body: '{}' });
  ok(r.status === 200, 'and can be claimed onto an account with that token');
  r = await bob.fetch('/api/auth/worlds');
  ok(r.body.worlds.some((w) => w.id === legacy.id), 'after claiming it shows up under the account');

  // ---- sign out really ends it ----
  await alice.fetch('/api/auth/logout', { method: 'POST' });
  r = await alice.fetch('/api/auth/worlds');
  ok(r.status === 401, 'signing out ends the session');

  // ---- the UI wires up ----
  const p = await browser.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('dialog', (d) => d.dismiss());
  await p.goto(base, { waitUntil: 'networkidle0' });
  const ui = await p.evaluate(() => ({ user: !!document.getElementById('acct-user'), pass: !!document.getElementById('acct-pass'), login: !!document.getElementById('btn-login'), signup: !!document.getElementById('btn-signup') }));
  ok(ui.user && ui.pass && ui.login && ui.signup, 'the menu offers sign in / create account');
  await p.type('#acct-user', CAROL);
  await p.type('#acct-pass', 'a good passphrase');
  await p.click('#btn-signup');
  await p.waitForFunction(() => !document.getElementById('acct-signed-in')?.classList.contains('hidden'), { timeout: 15000 });
  const who = await p.evaluate(() => document.getElementById('acct-name')?.textContent);
  ok(who === CAROL, `signing up in the UI signs the player in (${who})`);
  const persisted = await p.evaluate(async () => { const r = await fetch('/api/auth/me', { credentials: 'same-origin' }); return (await r.json()).user?.username; });
  ok(persisted === CAROL, 'the session survives as an HttpOnly cookie');
  const stolen = await p.evaluate(() => document.cookie.includes('sg_sess'));
  ok(!stolen, 'and page scripts cannot read the session cookie (XSS cannot lift the login)');
  ok(errs.length === 0, 'no console/page errors' + (errs.length ? ': ' + errs[0] : ''));
} catch (e) { fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
