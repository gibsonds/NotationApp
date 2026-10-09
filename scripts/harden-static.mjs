/** Add per-document script hashes. A CSP meta policy works on GitHub Pages too.
 * HTTP framing/HSTS policies are supplied by CloudFront. No unsafe-inline scripts. */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
async function walk(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir,item.name);
    if (item.isDirectory()) { await walk(file); continue; }
    if (!item.name.endsWith('.html')) continue;
    let html = await readFile(file,'utf8');
    html = html.replace(/<meta name="notation-csp"[^>]*>/g, '');
    const hashes = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
      .filter(m => !/\bsrc\s*=/i.test(m[1])).map(m => `'sha256-${createHash('sha256').update(m[2]).digest('base64')}'`);
    const policy = `script-src 'self' ${[...new Set(hashes)].join(' ')}; object-src 'none'; base-uri 'none'; form-action 'self'`;
    html = html.replace(/<head>/i, `<head><meta name="notation-csp" http-equiv="Content-Security-Policy" content="${policy}">`);
    await writeFile(file,html);
  }
}
await walk(process.argv[2] ?? 'out');
