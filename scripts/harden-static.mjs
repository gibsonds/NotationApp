/** Hash trusted inline scripts in generated static HTML; never use this to sanitize user HTML. */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from 'parse5';
function inspect(node, html, result) {
  const loc = node.sourceCodeLocation;
  if (node.tagName === 'head') result.headEnd = loc?.startTag?.endOffset;
  if (node.tagName === 'meta' && node.attrs?.some(a => a.name === 'name' && a.value === 'notation-csp')) result.oldMeta.push(loc);
  if (node.tagName === 'script' && !node.attrs.some(a => a.name === 'src') && loc?.startTag && loc?.endTag) {
    const script = html.slice(loc.startTag.endOffset, loc.endTag.startOffset);
    result.hashes.add(`'sha256-${createHash('sha256').update(script).digest('base64')}'`);
  }
  for (const child of node.childNodes ?? []) inspect(child, html, result);
}
async function walk(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, item.name);
    if (item.isDirectory()) { await walk(file); continue; }
    if (!item.name.endsWith('.html')) continue;
    let html = await readFile(file, 'utf8');
    const result = { headEnd: undefined, hashes: new Set(), oldMeta: [] };
    inspect(parse(html, { sourceCodeLocationInfo: true }), html, result);
    if (!result.headEnd) throw new Error(`Missing explicit head in ${file}`);
    for (const loc of result.oldMeta.sort((a,b) => b.startOffset-a.startOffset)) {
      html = html.slice(0, loc.startOffset) + html.slice(loc.endOffset);
    }
    const policy = `script-src 'self' ${[...result.hashes].join(' ')}; object-src 'none'; base-uri 'none'; form-action 'self'`;
    const meta = `<meta name="notation-csp" http-equiv="Content-Security-Policy" content="${policy}">`;
    html = html.slice(0, result.headEnd) + meta + html.slice(result.headEnd);
    await writeFile(file, html);
  }
}
await walk(process.argv[2] ?? 'out');
