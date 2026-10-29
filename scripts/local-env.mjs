import { writeFileSync,readFileSync,existsSync,chmodSync } from 'node:fs';
import {randomBytes}from'node:crypto';
import { localStatus, root } from './local-utils.mjs';
const status = localStatus();
const previous=existsSync(`${root}/.dev.vars`)?readFileSync(`${root}/.dev.vars`,'utf8'):'';
const keyLine=previous.split('\n').find(line=>/^ANALYTICS_HMAC_KEY=/.test(line));
let analyticsKey;
if(keyLine){const raw=keyLine.slice(keyLine.indexOf('=')+1).trim();try{analyticsKey=raw.startsWith('"')?JSON.parse(raw):raw.startsWith("'")&&raw.endsWith("'")?raw.slice(1,-1):raw;}catch{throw new Error('Invalid existing analytics key; refusing silent key rotation.');}}
else analyticsKey=randomBytes(32).toString('base64url');
if(typeof analyticsKey!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(analyticsKey)||Buffer.from(analyticsKey,'base64url').length!==32||Buffer.from(analyticsKey,'base64url').toString('base64url')!==analyticsKey)throw new Error('Invalid existing analytics key; refusing silent key rotation.');
const extra=previous.split('\n').filter(line=>line&&!/^(SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY|SUPABASE_SECRET_KEY|APP_ORIGIN|ANALYTICS_HMAC_KEY)=/.test(line)).join('\n');
const frontend=existsSync(`${root}/.env.local`)?readFileSync(`${root}/.env.local`,'utf8'):'';
const frontendExtra=frontend.split('\n').filter(line=>line&&!/^(VITE_SUPABASE_URL|VITE_SUPABASE_PUBLISHABLE_KEY|VITE_LOCAL_AUTH|VITE_GOOGLE_AUTH)=/.test(line)).join('\n');
writeFileSync(`${root}/.env.local`, `VITE_SUPABASE_URL=${status.url}\nVITE_SUPABASE_PUBLISHABLE_KEY=${status.publishable}\nVITE_LOCAL_AUTH=true\nVITE_GOOGLE_AUTH=false\n${frontendExtra?frontendExtra+'\n':''}`, { mode: 0o600 });
writeFileSync(`${root}/.dev.vars`, `SUPABASE_URL=${JSON.stringify(status.url)}\nSUPABASE_PUBLISHABLE_KEY=${JSON.stringify(status.publishable)}\nSUPABASE_SECRET_KEY=${JSON.stringify(status.secret)}\nAPP_ORIGIN="http://localhost:5173"\nANALYTICS_HMAC_KEY=${JSON.stringify(analyticsKey)}\n${extra?extra+'\n':''}`, { mode: 0o600 });
chmodSync(`${root}/.env.local`,0o600);chmodSync(`${root}/.dev.vars`,0o600);
console.log('Generated ignored local-only environment files. No key values printed.');
