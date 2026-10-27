import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
export const root = fileURLToPath(new URL('../', import.meta.url));
export function localStatus() {
  const data = JSON.parse(execFileSync(`${root}/node_modules/.bin/supabase`, ['status', '--output', 'json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  const url = data.API_URL || data.SUPABASE_URL;
  if (!url || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('Only a loopback local Supabase is allowed.');
  const publishable = data.PUBLISHABLE_KEY || data.ANON_KEY;
  const secret = data.SECRET_KEY || data.SERVICE_ROLE_KEY;
  if (!publishable || !secret) throw new Error('Local API keys were not available.');
  return { url, publishable, secret };
}
export function localAdmin() { const status = localStatus(); return createClient(status.url, status.secret, { auth: { persistSession: false, autoRefreshToken: false } }); }
export function localQuery(sql) {
  return execFileSync('docker', ['exec', '-i', 'supabase_db_reptilelink', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA'], { cwd: root, encoding: 'utf8', input: sql });
}
export const fixturePassword = 'Local-Reptilelink-Only-2026!';
export const fixtureEmails = ['breeder-a@reptilelink.test', 'breeder-b@reptilelink.test', 'qa-owner@reptilelink.test', 'qa-other@reptilelink.test', 'pending@reptilelink.test'];
