import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, link, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { hardenStatic } from './harden-static.mjs';

const fixtures = [];
const html = '<!doctype html><html><head><title>Test</title></head><body><script>window.ready=true</script></body></html>';
async function fixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'static-security-')));
  fixtures.push(base);
  const out = join(base, 'out');
  await mkdir(out);
  await writeFile(join(out, 'index.html'), html);
  return { base, out };
}
afterEach(async () => { await Promise.all(fixtures.splice(0).map(p => rm(p, { recursive: true, force: true }))); });

test('hashes inline scripts in nested HTML and remains idempotent', async () => {
  const { out } = await fixture();
  await mkdir(join(out, 'docs'));
  await writeFile(join(out, 'docs/index.html'), html);
  await hardenStatic(out, out);
  const once = await readFile(join(out, 'index.html'), 'utf8');
  const hash = createHash('sha256').update('window.ready=true').digest('base64');
  assert.ok(once.includes(`'sha256-${hash}'`));
  assert.equal(await readFile(join(out, 'docs/index.html'), 'utf8'), once);
  await hardenStatic(out, out);
  assert.equal(await readFile(join(out, 'index.html'), 'utf8'), once);
  assert.equal(once.match(/name="notation-csp"/g).length, 1);
});
test('rejects traversal and sibling paths without touching outside HTML', async () => {
  const { base, out } = await fixture();
  const outside = join(base, 'out-other');
  await mkdir(outside); await writeFile(join(outside, 'index.html'), html);
  await assert.rejects(hardenStatic(join(out, '../out-other'), out), /Output must be/);
  assert.equal(await readFile(join(outside, 'index.html'), 'utf8'), html);
});
test('CLI cannot redirect hardening outside the repository output folder', async () => {
  const { out } = await fixture();
  const result = spawnSync(process.execPath, [new URL('./harden-static.mjs', import.meta.url).pathname, out], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Output must be/);
  assert.equal(await readFile(join(out, 'index.html'), 'utf8'), html);
});
for (const kind of ['file', 'directory', 'non-html', 'dangling']) {
  test(`rejects ${kind} symlinks before changing any HTML`, async () => {
    const { base, out } = await fixture();
    const outside = join(base, 'outside');
    await mkdir(outside); await writeFile(join(outside, 'index.html'), html);
    const target = kind === 'directory' ? outside : join(outside, kind === 'dangling' ? 'missing' : 'index.html');
    await symlink(target, join(out, kind === 'file' ? 'linked.html' : 'linked'));
    await assert.rejects(hardenStatic(out, out), /Symlink/);
    assert.equal(await readFile(join(out, 'index.html'), 'utf8'), html);
    assert.equal(await readFile(join(outside, 'index.html'), 'utf8'), html);
  });
}
test('rejects a symlinked output root', async () => {
  const { base, out } = await fixture();
  const alias = join(base, 'alias'); await symlink(out, alias);
  await assert.rejects(hardenStatic(alias, alias), /Unsafe output root/);
});
test('rejects hard-linked HTML that could modify an outside file', async () => {
  const { base, out } = await fixture();
  const outside = join(base, 'outside.html'); await writeFile(outside, html);
  await link(outside, join(out, 'linked.html'));
  await assert.rejects(hardenStatic(out, out), /Hard-linked HTML/);
  assert.equal(await readFile(outside, 'utf8'), html);
});
