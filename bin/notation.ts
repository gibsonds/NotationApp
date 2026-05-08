#!/usr/bin/env tsx
/**
 * notation — small CLI for scripting NotationApp scores (#19).
 *
 * Reads a Score JSON from stdin (or argv path), optionally applies a list
 * of patches from a file or argv JSON, and writes the result to stdout.
 * Used for batch transformations, scripted authoring, and integration
 * tests that don't want to spin up the browser.
 *
 * Usage:
 *   notation parse < in.json > out.json
 *   notation patch -p patches.json < in.json > out.json
 *   notation patch -p '[{"op":"set_title","value":"Hi"}]' < in.json
 *   notation export-musicxml < in.json > out.musicxml
 *   notation export-midi    < in.json [--staff <id>] > out.mid
 *
 * Exit codes:
 *   0  ok
 *   1  invalid input / patch error
 *   2  usage error
 */

import * as fs from "node:fs";
import { ScoreSchema, ScorePatchSchema, type Score, type ScorePatch } from "../src/lib/schema";
import { applyPatch } from "../src/lib/patches";
import { scoreToMusicXML } from "../src/lib/musicxml";
import { scoreToMidi } from "../src/lib/midi-export";

const argv = process.argv.slice(2);
const cmd = argv[0];

function usage(code = 2): never {
  process.stderr.write(
    [
      "notation — score CLI (#19)",
      "",
      "Usage:",
      "  notation parse < in.json",
      "  notation patch [-p <patches.json|json>] < in.json",
      "  notation export-musicxml < in.json",
      "  notation export-midi    < in.json [--staff <id>]",
      "",
    ].join("\n"),
  );
  process.exit(code);
}

if (!cmd || cmd === "-h" || cmd === "--help") usage(0);

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { buf += chunk; });
    process.stdin.on("end", () => resolve(buf));
    process.stdin.on("error", reject);
  });
}

async function readJSON(): Promise<unknown> {
  const raw = await readStdin();
  if (!raw.trim()) {
    process.stderr.write("notation: no JSON on stdin\n");
    process.exit(2);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`notation: invalid JSON: ${(err as Error).message}\n`);
    process.exit(1);
  }
}

function parseScore(value: unknown): Score {
  const result = ScoreSchema.safeParse(value);
  if (!result.success) {
    process.stderr.write(
      "notation: invalid Score:\n" +
        result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n") +
        "\n",
    );
    process.exit(1);
  }
  return result.data;
}

function writeJSON(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

(async () => {
  if (cmd === "parse") {
    const score = parseScore(await readJSON());
    writeJSON(score);
    return;
  }

  if (cmd === "patch") {
    const flagIdx = argv.indexOf("-p");
    if (flagIdx === -1 || !argv[flagIdx + 1]) usage(2);
    const arg = argv[flagIdx + 1];
    let patchSource: string;
    if (arg.trim().startsWith("[") || arg.trim().startsWith("{")) {
      patchSource = arg;
    } else {
      try {
        patchSource = fs.readFileSync(arg, "utf8");
      } catch (err) {
        process.stderr.write(`notation: cannot read ${arg}: ${(err as Error).message}\n`);
        process.exit(1);
      }
    }
    let raw: unknown;
    try {
      raw = JSON.parse(patchSource);
    } catch (err) {
      process.stderr.write(`notation: invalid patch JSON: ${(err as Error).message}\n`);
      process.exit(1);
    }
    const patches: ScorePatch[] = [];
    const list = Array.isArray(raw) ? raw : [raw];
    for (const p of list) {
      const r = ScorePatchSchema.safeParse(p);
      if (!r.success) {
        process.stderr.write(
          "notation: invalid patch:\n" +
            r.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n") +
            "\n",
        );
        process.exit(1);
      }
      patches.push(r.data);
    }
    let score = parseScore(await readJSON());
    for (const p of patches) {
      score = applyPatch(score, p);
    }
    writeJSON(score);
    return;
  }

  if (cmd === "export-musicxml") {
    const score = parseScore(await readJSON());
    process.stdout.write(scoreToMusicXML(score));
    return;
  }

  if (cmd === "export-midi") {
    const score = parseScore(await readJSON());
    const staffFlag = argv.indexOf("--staff");
    const staffId = staffFlag !== -1 ? argv[staffFlag + 1] : undefined;
    const bytes = scoreToMidi(score, staffId ? { staffId } : undefined);
    process.stdout.write(Buffer.from(bytes));
    return;
  }

  usage(2);
})().catch((err) => {
  process.stderr.write(`notation: ${(err as Error).stack || (err as Error).message || err}\n`);
  process.exit(1);
});
