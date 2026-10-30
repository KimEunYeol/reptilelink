import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
// Bundle npm and extensionless repository imports locally; Deno receives one Web-API ESM module.
// Keep server code outside dist so it can never be served as a public asset.
await build({absWorkingDir:root,entryPoints:['netlify/edge-functions/reptilelink.ts'],
 outfile:join(root,'.netlify/edge-functions-generated/reptilelink.js'),bundle:true,
 platform:'browser',format:'esm',target:'es2022',sourcemap:false,logLevel:'warning'});
console.log('Netlify server bundle built locally outside the public asset directory.');
