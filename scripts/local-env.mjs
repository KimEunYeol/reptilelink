import { writeFileSync } from 'node:fs';
import { localStatus, root } from './local-utils.mjs';
const status = localStatus();
writeFileSync(`${root}/.env.local`, `VITE_SUPABASE_URL=${status.url}\nVITE_SUPABASE_PUBLISHABLE_KEY=${status.publishable}\nVITE_LOCAL_AUTH=true\nVITE_GOOGLE_AUTH=false\n`, { mode: 0o600 });
writeFileSync(`${root}/.dev.vars`, `SUPABASE_URL=${JSON.stringify(status.url)}\nSUPABASE_PUBLISHABLE_KEY=${JSON.stringify(status.publishable)}\nSUPABASE_SECRET_KEY=${JSON.stringify(status.secret)}\nAPP_ORIGIN="http://localhost:5173"\n`, { mode: 0o600 });
console.log('Generated ignored local-only environment files. No key values printed.');
