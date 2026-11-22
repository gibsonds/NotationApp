import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import parser from '@typescript-eslint/parser';

test('TypeScript project-service default-project globs work with patched minimatch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'typescript-glob-'));
  try {
    await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ files: ['included.ts'] }));
    await writeFile(join(root, 'included.ts'), 'export {};');
    const filePath = join(root, 'probe.ts');
    await writeFile(filePath, 'const value: number = 1;');
    const options = { filePath, tsconfigRootDir: root, projectService: { allowDefaultProject: ['probe.ts'] } };
    const result = parser.parseForESLint('const value: number = 1;', options);
    assert.ok(result.services.program);
    parser.clearCaches();
    assert.throws(() => parser.parseForESLint('const value: number = 1;', {
      ...options, projectService: { allowDefaultProject: ['different.ts'] },
    }), /not found|allowDefaultProject/);
    const require = createRequire(import.meta.url);
    const consumer = createRequire(require.resolve('@typescript-eslint/typescript-estree'));
    assert.equal(consumer('minimatch/package.json').version, '11.0.4');
  } finally {
    parser.clearCaches();
    await rm(root, { recursive: true, force: true });
  }
});
