#!/usr/bin/env node
/** Publish the InferMusic home and a pinned build of the existing scales app.
 * Usage: node scripts/deploy-infermusic.mjs [--publish]
 * Without --publish, prepares reviewable local files only.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args, options = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...options });
const aws = (...args) => JSON.parse(run('aws', [...args, '--region', 'us-east-1', '--output', 'json']));
const outputs = stack => Object.fromEntries(aws('cloudformation', 'describe-stacks', '--stack-name', stack).Stacks[0].Outputs.map(o => [o.OutputKey, o.OutputValue]));
const hosting = outputs('InferMusic');
const charts = outputs('NotationAuth');
const stage = mkdtempSync(path.join(tmpdir(), 'infermusic-publish-'));
const source = path.join(stage, 'source');
// Keep this pin explicit: a deploy must not silently publish unknown upstream changes.
const revision = '6511e01d56b66730c53c1b1a1a1d6f35ae237242';
run('git', ['init', '-q', source]);
run('git', ['-C', source, 'fetch', '--quiet', '--depth=1', 'https://github.com/gibsonds/guitar-scales.git', revision]);
run('git', ['-C', source, 'checkout', '--quiet', '--detach', 'FETCH_HEAD']);
const homeDir = path.join(stage, 'home');
const scalesDir = path.join(stage, 'scales');
mkdirSync(homeDir); mkdirSync(scalesDir);
for (const entry of ['index.html', 'config.js', 'diary-cloud.js', 'scales', 'chords']) cpSync(path.join(source, entry), path.join(scalesDir, entry), { recursive: true });
let home = readFileSync(path.join(root, 'sites/infermusic/index.html'), 'utf8');
home = home.replaceAll('https://charts.infermusic.ai/', `${charts.SiteUrl}/`).replaceAll('https://scales.infermusic.ai/', `${hosting.ScalesUrl}/`);
writeFileSync(path.join(homeDir, 'index.html'), home);
let scales = readFileSync(path.join(scalesDir, 'index.html'), 'utf8');
scales = scales.replace('<title>Guitar Scale Explorer</title>', '<title>InferMusic Scales — Guitar Scale Explorer</title>')
  .replace('<h1>🎸 Guitar Scale Explorer</h1>', '<h1>InferMusic Scales</h1>')
  .replace('Guitar Scale Explorer - Full Fretboard View - v2.16.0 - Deployed on GitHub Pages', 'InferMusic Scales · v2.16.0')
  .replace('<body>', `<body><nav aria-label="InferMusic tools" style="display:flex;gap:24px;align-items:center;min-height:44px;margin-bottom:20px;font:14px system-ui"><a style="color:inherit" href="${hosting.HomeUrl}/">InferMusic home</a><a style="color:inherit" href="${charts.SiteUrl}/">Charts</a><span aria-current="page">Scales</span></nav>`);
writeFileSync(path.join(scalesDir, 'index.html'), scales);
writeFileSync(path.join(stage, 'release.json'), JSON.stringify({ revision, home: hosting.HomeUrl, scales: hosting.ScalesUrl, charts: charts.SiteUrl }, null, 2));
console.log(`Prepared: ${stage}`);
if (process.argv.includes('--publish')) {
  // Preserve the existing API CORS configuration and add only our site origins.
  // The scales app's device pairing and diary sync continue using its existing API.
  const api = aws('apigatewayv2', 'get-api', '--api-id', '0f223nfaq2');
  const cors = api.CorsConfiguration;
  cors.AllowOrigins = [...new Set([...cors.AllowOrigins, hosting.ScalesUrl])];
  const corsPath = path.join(stage, 'scales-cors.json');
  writeFileSync(corsPath, JSON.stringify(cors));
  aws('apigatewayv2', 'update-api', '--api-id', '0f223nfaq2', '--cors-configuration', `file://${corsPath}`);
  for (const [name, dir] of [['home', homeDir], ['scales', scalesDir]]) {
    run('aws', ['s3', 'sync', dir, `s3://${hosting.SiteBucketName}/${name}/`, '--only-show-errors'], { stdio: 'inherit' });
  }
  for (const name of ['Home', 'Scales']) {
    aws('cloudfront', 'create-invalidation', '--distribution-id', hosting[`${name}DistributionId`], '--paths', '/*');
  }
  console.log(`Published home: ${hosting.HomeUrl}\nPublished scales: ${hosting.ScalesUrl}`);
}
