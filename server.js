import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomInt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const projectDirectory = fileURLToPath(new URL('.', import.meta.url));
const envPath = path.join(projectDirectory, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}
const password = process.env.ADMIN_PASSWORD;
if (!password || password.length < 16 || password === 'replace-with-a-long-unique-password') {
  console.error('Set ADMIN_PASSWORD to a unique password of at least 16 characters in .env.');
  process.exit(1);
}
const participantNames = JSON.parse(fs.readFileSync(new URL('./participants.json', import.meta.url), 'utf8'));
const participants = [...new Map(participantNames.map(name => {
  const cleaned = name.normalize('NFKC').trim().replace(/\s+/g, ' ');
  return [cleaned.toLocaleLowerCase('en'), cleaned];
})).values()].filter(Boolean);
if (participants.length < 3) throw new Error('At least three unique participants are required.');
const dataDirectory = path.resolve(process.env.DATA_DIR || './data');
fs.mkdirSync(dataDirectory, { recursive: true });
const statePath = path.join(dataDirectory, 'draw.json');
let draw = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : null;
const sessions = new Map();
const clients = new Set();
const viewers = new Map();
const attempts = new Map();
const duration = 18000;
function saveDraw(nextDraw) {
  fs.writeFileSync(`${statePath}.tmp`, JSON.stringify(nextDraw), { mode: 0o600 });
  fs.renameSync(`${statePath}.tmp`, statePath);
  draw = nextDraw;
}
function currentState() {
  const complete = draw && Date.now() >= draw.endsAt;
  return { participants, draw: draw ? { id: draw.id, startedAt: draw.startedAt, endsAt: draw.endsAt, winners: complete ? draw.winners : [], complete } : null, viewerCount: clients.size, serverTime: Date.now() };
}
function prunePollingClients() {
  for (const client of clients) {
    if (!client.response && client.expires <= Date.now()) {
      clients.delete(client);
      viewers.delete(client.id);
    }
  }
}
function validViewerId(value) {
  return typeof value === 'string' && /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/.test(value);
}
function send(response, event, value) {
  response.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
}
function broadcast() {
  for (const client of clients) {
    if (!client.response) continue;
    send(client.response, 'state', currentState());
    if (client.admin) send(client.response, 'viewers', [...viewers.values()]);
  }
}
function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}
async function body(request) {
  let content = '';
  for await (const chunk of request) {
    content += chunk;
    if (Buffer.byteLength(content) > 4096) throw new Error('Request too large.');
  }
  return JSON.parse(content || '{}');
}
function sessionFor(request) {
  const token = /(?:^|;\s*)admin=([a-f0-9]+)/.exec(request.headers.cookie || '')?.[1];
  const session = sessions.get(token);
  if (session && session.expires > Date.now()) return token;
  return null;
}
function hash(value) { return createHash('sha256').update(value).digest(); }
const server = http.createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'same-origin');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const requestUrl = new URL(request.url, 'http://localhost');
  const pathname = requestUrl.pathname;
  const token = sessionFor(request);
  try {
    if (request.method === 'GET' && pathname === '/health') return json(response, 200, { ok: true });
    if (request.method === 'GET' && pathname === '/api/session') return json(response, 200, { admin: Boolean(token), transport: process.env.LIVE_TRANSPORT === 'poll' ? 'poll' : 'sse' });
    if (request.method === 'GET' && pathname === '/api/state') return json(response, 200, currentState());
    if (request.method === 'GET' && pathname === '/api/events') {
      const requestedId = requestUrl.searchParams.get('id');
      const pageId = requestUrl.searchParams.get('pageId') || undefined;
      let client = [...clients].find(candidate => candidate.id === requestedId);
      if (!client && clients.size >= 500) return json(response, 503, { error: 'The room is full. Try again shortly.' });
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      if (!client) {
        client = { id: validViewerId(requestedId) ? requestedId : randomBytes(16).toString('hex') };
        clients.add(client);
      }
      const previousResponse = client.response;
      if (client.pageId !== pageId) viewers.delete(client.id);
      Object.assign(client, { response, admin: Boolean(token), token, pageId });
      previousResponse?.end();
      send(response, 'connected', { id: client.id, checkedIn: viewers.has(client.id) });
      broadcast();
      request.on('close', () => {
        if (client.response !== response) return;
        clients.delete(client);
        viewers.delete(client.id);
        broadcast();
      });
      return;
    }
    if (request.method === 'POST' && pathname.startsWith('/api/')) {
      const origin = request.headers.origin;
      if (!origin || new URL(origin).host !== request.headers.host || request.headers['sec-fetch-site'] === 'cross-site') return json(response, 403, { error: 'Invalid request origin.' });
      if (!request.headers['content-type']?.startsWith('application/json')) return json(response, 415, { error: 'JSON required.' });
      const input = await body(request);
      if (pathname === '/api/login') {
        const address = request.socket.remoteAddress;
        const record = attempts.get(address) || { count: 0, until: Date.now() + 900000 };
        if (record.until < Date.now()) { record.count = 0; record.until = Date.now() + 900000; }
        if (record.count >= 8) return json(response, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
        record.count += 1;
        attempts.set(address, record);
        if (typeof input.password !== 'string' || !timingSafeEqual(hash(input.password), hash(password))) return json(response, 401, { error: 'Incorrect admin password.' });
        attempts.delete(address);
        const newToken = randomBytes(32).toString('hex');
        sessions.set(newToken, { expires: Date.now() + 8 * 3600000 });
        const secure = process.env.COOKIE_SECURE === 'true' || request.socket.encrypted || request.headers['x-forwarded-proto'] === 'https';
        response.setHeader('Set-Cookie', `admin=${newToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure ? '; Secure' : ''}`);
        return json(response, 200, { admin: true });
      }
      if (pathname === '/api/poll') {
        prunePollingClients();
        let client = [...clients].find(candidate => candidate.id === input.id);
        if (!client) {
          if (clients.size >= 500) return json(response, 503, { error: 'The room is full. Try again shortly.' });
          client = { response: null, id: validViewerId(input.id) ? input.id : randomBytes(16).toString('hex') };
          clients.add(client);
        }
        const previousResponse = client.response;
        client.response = null;
        previousResponse?.end();
        if (client.pageId !== input.pageId) viewers.delete(client.id);
        client.pageId = input.pageId;
        client.admin = Boolean(token);
        client.token = token;
        client.expires = Date.now() + 45000;
        return json(response, 200, { id: client.id, checkedIn: viewers.has(client.id), admin: Boolean(token), state: currentState(), ...(token ? { viewers: [...viewers.values()] } : {}) });
      }
      if (pathname === '/api/watch') {
        const client = [...clients].find(candidate => candidate.id === input.id);
        if (!client) return json(response, 400, { error: 'Reconnect before checking in.' });
        if (client.pageId !== input.pageId) return json(response, 409, { error: 'Reconnect before checking in.' });
        if (typeof input.name !== 'string' || input.name.trim().length < 2 || input.name.trim().length > 80 || /[\x00-\x1f]/.test(input.name)) return json(response, 400, { error: 'Enter a name between 2 and 80 characters.' });
        viewers.set(client.id, { name: input.name.trim(), joinedAt: Date.now() });
        broadcast();
        return json(response, 200, { ok: true });
      }
      if (pathname === '/api/leave') {
        const client = [...clients].find(candidate => candidate.id === input.id && candidate.pageId === input.pageId);
        if (client) {
          clients.delete(client);
          viewers.delete(client.id);
          client.response?.end();
          broadcast();
        }
        return json(response, 200, { ok: true });
      }
      if (!token) return json(response, 401, { error: 'Admin login required.' });
      if (pathname === '/api/logout') {
        sessions.delete(token);
        for (const client of clients) if (client.token === token) { client.admin = false; client.response?.end(); }
        response.setHeader('Set-Cookie', 'admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
        return json(response, 200, { ok: true });
      }
      if (pathname === '/api/spin') {
        if (draw) return json(response, 409, { error: 'This draw has already started. Reset to run a new draw.' });
        const shuffled = [...participants];
        for (let index = shuffled.length - 1; index > 0; index--) {
          const swapIndex = randomInt(index + 1);
          [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
        }
        const startedAt = Date.now();
        saveDraw({ id: randomBytes(12).toString('hex'), startedAt, endsAt: startedAt + duration, winners: shuffled.slice(0, 3) });
        broadcast();
        setTimeout(broadcast, duration + 20);
        return json(response, 200, { ok: true });
      }
      if (pathname === '/api/reset') {
        if (draw && Date.now() < draw.endsAt) return json(response, 409, { error: 'Wait for this draw to finish.' });
        saveDraw(null);
        broadcast();
        return json(response, 200, { ok: true });
      }
      return json(response, 404, { error: 'Not found.' });
    }
    const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'] };
    if (request.method === 'GET' && files[pathname]) {
      const [filename, type] = files[pathname];
      response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-cache' });
      return fs.createReadStream(path.join(projectDirectory, 'public', filename)).pipe(response);
    }
    json(response, 404, { error: 'Not found.' });
  } catch (error) {
    console.error(error.message);
    if (!response.headersSent) json(response, 400, { error: 'Unable to process request.' });
    else response.end();
  }
});
if (draw && Date.now() < draw.endsAt) setTimeout(broadcast, draw.endsAt - Date.now() + 20);
setInterval(() => {
  prunePollingClients();
  for (const [token, session] of sessions) if (session.expires <= Date.now()) sessions.delete(token);
  for (const [address, record] of attempts) if (record.until <= Date.now()) attempts.delete(address);
  for (const client of clients) {
    if (!client.response) continue;
    if (client.admin && !sessions.has(client.token)) { client.response.end(); continue; }
    client.response.write(': heartbeat\n\n');
  }
  broadcast();
}, 15000).unref();
server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log(`Draw room ready on port ${process.env.PORT || 3000}`));
