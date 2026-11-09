import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] in process.env) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const secret = process.env.SUPABASE_SECRET_KEY || '';
if (!/^https:\/\//i.test(supabaseUrl) || !secret.startsWith('sb_secret_')) {
  throw new Error('Configure SUPABASE_URL e SUPABASE_SECRET_KEY (sb_secret_) no .env antes da migração.');
}

const dbPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'data', 'avaliacoes.sqlite');
if (!fs.existsSync(dbPath)) throw new Error(`Banco SQLite não encontrado: ${dbPath}`);
const db = new DatabaseSync(dbPath, { readOnly: true });

async function request(table, query = '', { method = 'GET', value, prefer = '' } = {}) {
  const headers = { apikey: secret, accept: 'application/json' };
  if (value !== undefined) headers['content-type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}${query}`, {
    method, headers, body: value === undefined ? undefined : JSON.stringify(value)
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(`Supabase (${response.status}): ${data?.message || data?.hint || 'falha durante a migração.'}`);
  return data;
}

try {
  const localClients = db.prepare('SELECT id,name,birth_date,sex,phone FROM clients ORDER BY id').all();
  const localEvaluations = db.prepare('SELECT id,client_id,evaluated_on,modules,payload FROM evaluations ORDER BY id').all();
  let importedEvaluations = 0;
  for (const client of localClients) {
    const created = await request('clients', '?on_conflict=legacy_id', {
      method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation',
      value: {
        legacy_id: Number(client.id),
        name: client.name,
        birth_date: client.birth_date || null,
        sex: client.sex || null,
        phone: client.phone || null
      }
    });
    const existing = created?.[0] ? created : await request('clients', `?select=id&legacy_id=eq.${Number(client.id)}`);
    const cloudClientId = Number(existing?.[0]?.id);
    if (!Number.isSafeInteger(cloudClientId)) throw new Error('O Supabase não retornou o identificador de um aluno importado.');
    for (const evaluation of localEvaluations.filter(item => Number(item.client_id) === Number(client.id))) {
      await request('evaluations', '?on_conflict=legacy_id', {
        method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal',
        value: {
          legacy_id: Number(evaluation.id),
          client_id: cloudClientId,
          evaluated_on: evaluation.evaluated_on,
          modules: JSON.parse(evaluation.modules),
          payload: JSON.parse(evaluation.payload)
        }
      });
      importedEvaluations += 1;
    }
  }
  console.log(JSON.stringify({
    status: 'concluida',
    sqlite_clients: localClients.length,
    sqlite_evaluations: localEvaluations.length,
    upserted_clients: localClients.length,
    upserted_evaluations: importedEvaluations
  }));
} finally {
  db.close();
}
