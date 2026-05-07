#!/usr/bin/env node
// Append a changelog entry for the current HEAD commit to docs/CHANGELOG.md.
// Invoked from .github/workflows/update-docs.yml after each push to main.

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const CHANGELOG_PATH = "docs/CHANGELOG.md";

const sh = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();

const sha = sh("git rev-parse HEAD");
const shortSha = sha.slice(0, 7);
const fullMessage = sh("git log -1 --pretty=%B HEAD");
const summary = fullMessage.split("\n")[0].trim() || "(no commit message)";
const author = sh("git log -1 --pretty=%an HEAD");
const isoDate = new Date().toISOString().slice(0, 10);

let changedFiles = [];
try {
  const raw = sh("git diff HEAD~1 HEAD --name-only");
  changedFiles = raw.split("\n").map((s) => s.trim()).filter(Boolean);
} catch {
  // First commit on the branch — fall back to listing files in HEAD.
  const raw = sh("git show --name-only --pretty=format: HEAD");
  changedFiles = raw.split("\n").map((s) => s.trim()).filter(Boolean);
}

const fileList = changedFiles.length
  ? changedFiles.map((f) => `  - \`${f}\``).join("\n")
  : "  - _(no file changes detected)_";

const entry = `## ${isoDate} — ${shortSha}

**${summary}**

- Commit: [\`${shortSha}\`](../../commit/${sha})
- Author: ${author}
- Files changed:
${fileList}

`;

const dir = dirname(CHANGELOG_PATH);
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

const header = `# Changelog

Auto-generated from commits to \`main\` by \`.github/workflows/update-docs.yml\`.
Newest entries on top.

`;

let existing = "";
if (existsSync(CHANGELOG_PATH)) {
  existing = readFileSync(CHANGELOG_PATH, "utf8");
  // Strip the header from the existing file so we can re-prepend the new entry
  // beneath a single canonical header.
  if (existing.startsWith("# Changelog")) {
    const split = existing.indexOf("## ");
    existing = split === -1 ? "" : existing.slice(split);
  }
}

// Skip if HEAD's SHA is already the most recent entry — guards against the
// workflow being re-run on the same commit.
if (existing.includes(`— ${shortSha}\n`)) {
  console.log(`Entry for ${shortSha} already present — skipping.`);
  process.exit(0);
}

writeFileSync(CHANGELOG_PATH, header + entry + existing);
console.log(`Appended changelog entry for ${shortSha}.`);
