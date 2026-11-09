import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const dataDir = path.join(root, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const localEnvPath = path.join(root, '.env');
if (fs.existsSync(localEnvPath)) {
  for (const line of fs.readFileSync(localEnvPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] in process.env) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
const requireAuth = process.env.REQUIRE_AUTH === '1';
const passwordHash = process.env.APP_PASSWORD_HASH || '';
if (process.env.NODE_ENV === 'production' && (!requireAuth || !passwordHash.startsWith('scrypt$'))) {
  throw new Error('Em produção, configure REQUIRE_AUTH=1 e APP_PASSWORD_HASH antes de iniciar.');
}
if (requireAuth && !/^scrypt\$[A-Za-z0-9+/]+=*\$[A-Za-z0-9+/]+=*$/.test(passwordHash)) {
  throw new Error('APP_PASSWORD_HASH inválido. Gere-o com scripts/gerar-hash-senha.mjs.');
}
const sessions = new Map();
const loginAttempts = new Map();
const SESSION_MS = 12 * 60 * 60 * 1000;
const db = new DatabaseSync(path.join(dataDir, 'avaliacoes.sqlite'));
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  birth_date TEXT,
  sex TEXT,
  phone TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  evaluated_on TEXT NOT NULL,
  modules TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`);

const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY || '';
const useSupabase = process.env.DATA_STORE === 'supabase';
if (useSupabase && (!/^https:\/\//i.test(supabaseUrl) || !supabaseSecretKey.startsWith('sb_secret_'))) {
  throw new Error('DATA_STORE=supabase exige SUPABASE_URL HTTPS e SUPABASE_SECRET_KEY sb_secret_.');
}

async function supabaseRequest(table, query = '', { method = 'GET', value, prefer = '', range } = {}) {
  const headers = { apikey: supabaseSecretKey, accept: 'application/json' };
  if (value !== undefined) headers['content-type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  if (range) { headers.Range = `${range[0]}-${range[1]}`; headers['Range-Unit'] = 'items'; }
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}${query}`, {
    method, headers, body: value === undefined ? undefined : JSON.stringify(value)
  });
  const resultText = await response.text();
  let result;
  try { result = resultText ? JSON.parse(resultText) : null; } catch { result = resultText; }
  if (!response.ok) throw new Error(`Supabase (${response.status}): ${result?.message || result?.hint || 'falha ao consultar o banco.'}`);
  return result;
}

async function supabaseRows(table, query = '', order = 'id.asc') {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const suffix = `${query}${query ? '&' : '?'}order=${encodeURIComponent(order)}`;
    const page = await supabaseRequest(table, suffix, { range: [offset, offset + 999] });
    rows.push(...(Array.isArray(page) ? page : []));
    if (!Array.isArray(page) || page.length < 1000) return rows;
  }
}

if (process.env.NODE_ENV !== 'production' && process.env.DATA_STORE !== 'supabase' && db.prepare('SELECT COUNT(*) AS n FROM clients').get().n === 0) {
  const addClient = db.prepare('INSERT INTO clients(name,birth_date,sex,phone) VALUES(?,?,?,?)');
  const sample = addClient.run('Demonstração — dados fictícios', '1992-05-14', 'Feminino', null);
  const addEval = db.prepare('INSERT INTO evaluations(client_id,evaluated_on,modules,payload) VALUES(?,?,?,?)');
  addEval.run(sample.lastInsertRowid, '2026-08-14', JSON.stringify(['anthropometry']), JSON.stringify({ weight:'68.4', height:'165', waist:'78', hip:'98', anthro_notes:'Registro ilustrativo fictício.' }));
  addEval.run(sample.lastInsertRowid, '2026-10-14', JSON.stringify(['anthropometry','physical']), JSON.stringify({ weight:'67.8', height:'165', waist:'76.5', hip:'97', physical_notes:'Registro ilustrativo fictício; não representa pessoa real.' }));
}

const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png' };
const json = (res, status, data) => { res.writeHead(status, { 'content-type': mime['.json'], 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
function sessionFor(req) {
  const token = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('movimento_session='))?.slice('movimento_session='.length);
  const session = token && sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) { sessions.delete(token); return null; }
  session.expiresAt = Date.now() + SESSION_MS;
  return token;
}
function checkPassword(password) {
  const [, saltText, digestText] = passwordHash.split('$');
  const expected = Buffer.from(digestText, 'base64');
  const actual = scryptSync(password, Buffer.from(saltText, 'base64'), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
function safeEqual(left, right) {
  const a = Buffer.from(left || ''); const b = Buffer.from(right || '');
  return a.length === b.length && timingSafeEqual(a, b);
}
function sameOrigin(req) {
  if (!req.headers.origin) return true;
  try { return new URL(req.headers.origin).host === req.headers.host; } catch { return false; }
}
function clientAddress(req) { return req.socket.remoteAddress || 'unknown'; }
const body = req => new Promise((resolve, reject) => {
  let raw = ''; req.on('data', chunk => { raw += chunk; if (raw.length > 8_000_000) reject(new Error('Payload muito grande')); });
  req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { reject(new Error('JSON inválido')); } });
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    const session = requireAuth ? sessionFor(req) : null;
    if (req.method === 'GET' && url.pathname === '/api/session') return json(res, 200, { authRequired: requireAuth, authenticated: !requireAuth || Boolean(session) });
    if (req.method === 'POST' && url.pathname === '/api/login') {
      if (!requireAuth) return json(res, 400, { error: 'O login não está habilitado.' });
      if (!sameOrigin(req)) return json(res, 403, { error: 'Origem inválida.' });
      const address = clientAddress(req); const attempt = loginAttempts.get(address) || { count: 0, blockedUntil: 0 };
      if (attempt.blockedUntil > Date.now()) return json(res, 429, { error: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' });
      const value = await body(req);
      if (typeof value.password !== 'string' || value.password.length > 1024 || !checkPassword(value.password)) {
        attempt.count += 1;
        if (attempt.count >= 5) { attempt.count = 0; attempt.blockedUntil = Date.now() + 15 * 60 * 1000; }
        loginAttempts.set(address, attempt);
        return json(res, 401, { error: 'Senha incorreta.' });
      }
      loginAttempts.delete(address);
      const token = randomBytes(32).toString('base64url');
      sessions.set(token, { expiresAt: Date.now() + SESSION_MS });
      res.writeHead(200, { 'content-type': mime['.json'], 'set-cookie': `movimento_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_MS / 1000}`, 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ authenticated: true }));
    }
    if (req.method === 'POST' && url.pathname === '/api/logout') {
      if (!sameOrigin(req)) return json(res, 403, { error: 'Origem inválida.' });
      if (session) sessions.delete(session);
      res.writeHead(200, { 'content-type': mime['.json'], 'set-cookie': 'movimento_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ authenticated: false }));
    }
    if (requireAuth && url.pathname.startsWith('/api/') && !session) return json(res, 401, { error: 'Sessão encerrada. Entre novamente.' });
    if (req.method === 'POST' && url.pathname.startsWith('/api/') && !sameOrigin(req)) return json(res, 403, { error: 'Origem inválida.' });
    if (req.method === 'GET' && url.pathname === '/api/export') {
      if (useSupabase) {
        const [cloudClients, cloudEvaluations] = await Promise.all([
          supabaseRows('clients', '?select=*', 'id.asc'),
          supabaseRows('evaluations', '?select=*', 'id.asc')
        ]);
        const grouped = new Map();
        for (const evaluation of cloudEvaluations) {
          const list = grouped.get(Number(evaluation.client_id)) || [];
          list.push(evaluation);
          grouped.set(Number(evaluation.client_id), list);
        }
        const clients = cloudClients.map(client => ({
          ...client,
          evaluations: (grouped.get(Number(client.id)) || []).sort((a, b) => a.evaluated_on.localeCompare(b.evaluated_on) || a.id - b.id)
        }));
        res.writeHead(200, { 'content-type': mime['.json'], 'content-disposition': 'attachment; filename="movimento-backup.json"' });
        return res.end(JSON.stringify({ exported_at: new Date().toISOString(), clients }, null, 2));
      }
      const clients = db.prepare('SELECT * FROM clients ORDER BY id').all().map(client => ({
        ...client,
        evaluations: db.prepare('SELECT * FROM evaluations WHERE client_id=? ORDER BY evaluated_on,id').all(client.id).map(e => ({ ...e, modules: JSON.parse(e.modules), payload: JSON.parse(e.payload) }))
      }));
      res.writeHead(200, { 'content-type': mime['.json'], 'content-disposition': 'attachment; filename="movimento-backup.json"' });
      return res.end(JSON.stringify({ exported_at: new Date().toISOString(), clients }, null, 2));
    }
    if (req.method === 'GET' && url.pathname === '/api/clients') {
      if (useSupabase) {
        const [cloudClients, cloudEvaluations] = await Promise.all([
          supabaseRows('clients', '?select=*', 'name.asc,id.asc'),
          supabaseRows('evaluations', '?select=*', 'id.asc')
        ]);
        const summary = new Map();
        for (const evaluation of cloudEvaluations) {
          const key = Number(evaluation.client_id);
          const item = summary.get(key) || { count: 0, last: null };
          item.count += 1;
          if (!item.last || evaluation.evaluated_on > item.last) item.last = evaluation.evaluated_on;
          summary.set(key, item);
        }
        return json(res, 200, cloudClients.map(client => ({
          ...client,
          evaluation_count: summary.get(Number(client.id))?.count || 0,
          last_evaluation: summary.get(Number(client.id))?.last || null
        })));
      }
      const rows = db.prepare(`SELECT c.*, COUNT(e.id) AS evaluation_count,
        MAX(e.evaluated_on) AS last_evaluation FROM clients c
        LEFT JOIN evaluations e ON e.client_id=c.id GROUP BY c.id ORDER BY c.name COLLATE NOCASE`).all();
      return json(res, 200, rows);
    }
    if (req.method === 'POST' && url.pathname === '/api/clients') {
      const value = await body(req);
      if (!String(value.name || '').trim()) return json(res, 400, { error: 'Informe o nome.' });
      if (useSupabase) {
        const inserted = await supabaseRequest('clients', '', {
          method: 'POST', prefer: 'return=representation',
          value: { name: String(value.name).trim(), birth_date: value.birth_date || null, sex: value.sex || null, phone: value.phone || null }
        });
        return json(res, 201, inserted?.[0] || {});
      }
      const result = db.prepare('INSERT INTO clients(name,birth_date,sex,phone) VALUES(?,?,?,?)')
        .run(String(value.name).trim(), value.birth_date || null, value.sex || null, value.phone || null);
      return json(res, 201, db.prepare('SELECT * FROM clients WHERE id=?').get(result.lastInsertRowid));
    }
    const clientMatch = url.pathname.match(/^\/api\/clients\/(\d+)$/);
    if (req.method === 'GET' && clientMatch) {
      if (useSupabase) {
        const id = Number(clientMatch[1]);
        const clients = await supabaseRequest('clients', `?select=*&id=eq.${id}`);
        if (!clients?.length) return json(res, 404, { error: 'Aluno não encontrado.' });
        const evaluations = await supabaseRows('evaluations', `?select=*&client_id=eq.${id}`, 'evaluated_on.desc,id.desc');
        return json(res, 200, { ...clients[0], evaluations });
      }
      const client = db.prepare('SELECT * FROM clients WHERE id=?').get(Number(clientMatch[1]));
      if (!client) return json(res, 404, { error: 'Aluno não encontrado.' });
      client.evaluations = db.prepare('SELECT * FROM evaluations WHERE client_id=? ORDER BY evaluated_on DESC,id DESC').all(client.id).map(e => ({ ...e, modules: JSON.parse(e.modules), payload: JSON.parse(e.payload) }));
      return json(res, 200, client);
    }
    const evalMatch = url.pathname.match(/^\/api\/clients\/(\d+)\/evaluations$/);
    if (req.method === 'POST' && evalMatch) {
      const clientId = Number(evalMatch[1]);
      if (useSupabase) {
        const clients = await supabaseRequest('clients', `?select=id&id=eq.${clientId}`);
        if (!clients?.length) return json(res, 404, { error: 'Aluno não encontrado.' });
        const value = await body(req);
        if (!value.evaluated_on || !Array.isArray(value.modules) || !value.modules.length) return json(res, 400, { error: 'Informe a data e ao menos um módulo.' });
        const inserted = await supabaseRequest('evaluations', '', {
          method: 'POST', prefer: 'return=representation',
          value: { client_id: clientId, evaluated_on: value.evaluated_on, modules: value.modules, payload: value.payload || {} }
        });
        return json(res, 201, { id: Number(inserted?.[0]?.id) });
      }
      if (!db.prepare('SELECT id FROM clients WHERE id=?').get(clientId)) return json(res, 404, { error: 'Aluno não encontrado.' });
      const value = await body(req);
      if (!value.evaluated_on || !Array.isArray(value.modules) || !value.modules.length) return json(res, 400, { error: 'Informe a data e ao menos um módulo.' });
      const result = db.prepare('INSERT INTO evaluations(client_id,evaluated_on,modules,payload) VALUES(?,?,?,?)')
        .run(clientId, value.evaluated_on, JSON.stringify(value.modules), JSON.stringify(value.payload || {}));
      return json(res, 201, { id: Number(result.lastInsertRowid) });
    }
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Rota não encontrada.' });
    if (requireAuth && !session && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return fs.createReadStream(path.join(publicDir, 'login.html')).pipe(res);
    }
    const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const target = path.resolve(publicDir, requested);
    if (!target.startsWith(path.resolve(publicDir) + path.sep) && target !== path.join(publicDir, 'index.html')) return json(res, 403, { error: 'Acesso negado.' });
    if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) return json(res, 404, { error: 'Arquivo não encontrado.' });
    res.writeHead(200, { 'content-type': mime[path.extname(target)] || 'application/octet-stream' });
    fs.createReadStream(target).pipe(res);
  } catch (error) {
    json(res, 500, { error: error.message || 'Erro interno.' });
  }
});

const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
server.listen(port, host, () => console.log(`Avaliação Física Beta: http://${host}:${port}`));
process.on('SIGINT', () => { db.close(); server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { db.close(); server.close(() => process.exit(0)); });
