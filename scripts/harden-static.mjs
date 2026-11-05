/** Hash trusted inline scripts in generated static HTML; never use this to sanitize user HTML. */
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
const outputRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../out');
function contained(root, file) {
  const path = relative(root, file);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !path.startsWith(sep));
}
async function collect(root, dir, files) {
  if (!contained(root, dir) || await realpath(dir) !== dir) throw new Error(`Unsafe output directory: ${dir}`);
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, item.name);
    const stat = await lstat(file);
    if (stat.isSymbolicLink()) throw new Error(`Symlink in static output: ${file}`);
    if (stat.isDirectory()) { await collect(root, file, files); continue; }
    if (!stat.isFile()) throw new Error(`Non-regular static output: ${file}`);
    if (!item.name.endsWith('.html')) continue;
    if (stat.nlink !== 1) throw new Error(`Hard-linked HTML in static output: ${file}`);
    files.push({ file, stat });
  }
}
// expectedRoot is explicit for isolated tests; the CLI always fixes it to this repo's out/.
export async function hardenStatic(dir = outputRoot, expectedRoot = outputRoot) {
  const root = resolve(expectedRoot);
  if (resolve(dir) !== root) throw new Error(`Output must be ${root}`);
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(root) !== root) throw new Error(`Unsafe output root: ${root}`);
  const files = [];
  // Reject the entire unsafe tree before modifying any HTML.
  await collect(root, root, files);
  for (const { file, stat: original } of files) {
    const handle = await open(file, constants.O_RDWR | constants.O_NOFOLLOW);
    try {
      const current = await handle.stat();
      if (!current.isFile() || current.nlink !== 1 || current.dev !== original.dev || current.ino !== original.ino || await realpath(file) !== file || !contained(root, file)) throw new Error(`Static output changed during hardening: ${file}`);
      let html = await handle.readFile('utf8');
      const result = { headEnd: undefined, hashes: new Set(), oldMeta: [] };
      inspect(parse(html, { sourceCodeLocationInfo: true }), html, result);
      if (!result.headEnd) throw new Error(`Missing explicit head in ${file}`);
      for (const loc of result.oldMeta.sort((a,b) => b.startOffset-a.startOffset)) {
        html = html.slice(0, loc.startOffset) + html.slice(loc.endOffset);
      }
      const policy = `script-src 'self' ${[...result.hashes].join(' ')}; object-src 'none'; base-uri 'none'; form-action 'self'`;
      const meta = `<meta name="notation-csp" http-equiv="Content-Security-Policy" content="${policy}">`;
      html = html.slice(0, result.headEnd) + meta + html.slice(result.headEnd);
      const data = Buffer.from(html);
      let offset = 0;
      while (offset < data.length) {
        const { bytesWritten } = await handle.write(data, offset, data.length - offset, offset);
        if (!bytesWritten) throw new Error(`Unable to write ${file}`);
        offset += bytesWritten;
      }
      await handle.truncate(data.length);
    } finally {
      await handle.close();
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length > 3) throw new Error('Usage: node scripts/harden-static.mjs [out]');
  await hardenStatic(process.argv[2] ? resolve(process.argv[2]) : outputRoot);
}
