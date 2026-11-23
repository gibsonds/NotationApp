/** Local-only harness: bundles actual invitation UI and grant engine with fake auth,
 * in-memory data and an injected mock mail transport. Never loads .env files. */
import {build} from '../infra/node_modules/esbuild/lib/main.js';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=await mkdtemp(path.join(tmpdir(),'charts-invitation-preview-'));
const aliasAuth=path.join(root,'scripts/invitation-preview/auth.ts');
await build({entryPoints:[path.join(root,'scripts/invitation-preview/app.tsx')],bundle:true,platform:'browser',format:'iife',jsx:'automatic',outfile:path.join(out,'app.js'),alias:{'@/lib/auth':aliasAuth,'@':path.join(root,'src')},define:{'process.env.NEXT_PUBLIC_API_BASE':'"/api"','process.env.NEXT_PUBLIC_MULTI_BOOK_INVITES':'"1"','process.env.NODE_ENV':'"development"'}});
await build({entryPoints:[path.join(root,'scripts/invitation-preview/server.ts')],bundle:true,platform:'node',format:'cjs',outfile:path.join(out,'server.cjs'),plugins:[{name:'fake-ddb',setup(b){b.onResolve({filter:/^\.\/ddb$/},()=>({path:path.join(root,'scripts/invitation-preview/store.ts')}));}}]});
// Tailwind CLI is not needed: use the repo's installed PostCSS/Tailwind plugin.
const {default:postcss}=await import('../node_modules/postcss/lib/postcss.mjs');
const {default:tailwind}=await import('../node_modules/@tailwindcss/postcss/dist/index.mjs');
const css=await postcss([tailwind({base:root})]).process('@import "tailwindcss";',{from:path.join(root,'src/app/preview.css')});
await writeFile(path.join(out,'style.css'),css.css);
await writeFile(path.join(out,'index.html'),'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Charts · synthetic invitation preview</title><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
const child=spawn(process.execPath,[path.join(out,'server.cjs')],{stdio:'inherit',env:{PREVIEW_BUILD:out,PREVIEW_PORT:process.env.PREVIEW_PORT??'4319',PATH:process.env.PATH}});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code??0));
