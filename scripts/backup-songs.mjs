#!/usr/bin/env node
/**
 * Full backup of the NotationApp DynamoDB table (all songs + version
 * history, every device) to a timestamped JSON file.
 *
 * Usage:
 *   node scripts/backup-songs.mjs [output-dir]
 *
 * Default output dir: ~/NotationApp-backups
 * Requires AWS credentials with read access to the table (same profile
 * used for `cdk deploy`). Uses the AWS CLI — no npm dependencies.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const TABLE = "NotationApp";
const outDir = process.argv[2] ?? join(homedir(), "NotationApp-backups");
mkdirSync(outDir, { recursive: true });

const items = [];
let startKey = null;
do {
  const args = ["dynamodb", "scan", "--table-name", TABLE, "--output", "json"];
  if (startKey) args.push("--exclusive-start-key", JSON.stringify(startKey));
  const page = JSON.parse(
    execFileSync("aws", args, { maxBuffer: 256 * 1024 * 1024 }).toString()
  );
  items.push(...page.Items);
  startKey = page.LastEvaluatedKey ?? null;
} while (startKey);

const songs = items.filter((i) => i.entity?.S === "Song");
const versions = items.filter((i) => i.entity?.S === "Version");

const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
const outFile = join(outDir, `notationapp-backup-${stamp}.json`);
writeFileSync(outFile, JSON.stringify({ Items: items }, null, 1));

console.log(`Backed up ${items.length} items (${songs.length} songs, ${versions.length} versions)`);
console.log(`  -> ${outFile}`);
for (const s of songs) {
  const t = new Date(Number(s.updatedAt?.N ?? 0)).toISOString().slice(0, 16);
  console.log(`  ${t}  ${s.title?.S ?? "?"}`);
}
