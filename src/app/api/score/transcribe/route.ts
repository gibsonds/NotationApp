import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { writeFile, readFile, unlink, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { v4 as uuidv4 } from "uuid";
import { parseMidi } from "@/lib/importers/midi-import";

// Path to the basic-pitch CLI in our venv (outside project to avoid Turbopack scanning)
const HOME = process.env.HOME || "/Users/davidgibson";
const BASIC_PITCH = join(HOME, ".notation-venv", "bin", "basic-pitch");

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  const ext = file.name.split(".").pop()?.toLowerCase();
  const supported = ["mp3", "m4a", "wav", "aif", "aiff", "ogg", "flac", "mp4"];
  if (!ext || !supported.includes(ext)) {
    return NextResponse.json(
      { error: `Unsupported audio format: .${ext}. Supported: ${supported.join(", ")}` },
      { status: 400 }
    );
  }

  // Write audio to temp file
  const id = uuidv4();
  const tmpDir = join(tmpdir(), `notation-transcribe-${id}`);
  await mkdir(tmpDir, { recursive: true });

  const inputPath = join(tmpDir, `input.${ext}`);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(inputPath, buffer);

  try {
    // Run basic-pitch
    const midiPath = await runBasicPitch(inputPath, tmpDir);

    // Parse the resulting MIDI file using our existing importer
    const midiData = await readFile(midiPath);
    const score = parseMidi(midiData.buffer);

    // Use the audio filename as title
    const title = file.name.replace(/\.[^.]+$/, "").replace(/([A-Z])/g, " $1").trim();
    score.title = title;

    return NextResponse.json({
      score,
      message: `Transcribed ${file.name}: ${score.staves.length} part(s), ${score.measures} measures.`,
    });
  } catch (err: any) {
    console.error("Transcription error:", err);
    return NextResponse.json(
      { error: `Transcription failed: ${err.message}` },
      { status: 500 }
    );
  } finally {
    // Cleanup temp files
    try {
      const { readdir } = await import("fs/promises");
      const files = await readdir(tmpDir);
      for (const f of files) await unlink(join(tmpDir, f)).catch(() => {});
      const { rmdir } = await import("fs/promises");
      await rmdir(tmpDir).catch(() => {});
    } catch {}
  }
}

function runBasicPitch(inputPath: string, outputDir: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      BASIC_PITCH,
      [outputDir, inputPath, "--save-midi"],
      { timeout: 120000 }, // 2 min max
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`basic-pitch failed: ${stderr || error.message}`));
          return;
        }

        // basic-pitch outputs: <outputDir>/<inputBasename>_basic_pitch.mid
        const baseName = inputPath.split("/").pop()!.replace(/\.[^.]+$/, "");
        const midiPath = join(outputDir, `${baseName}_basic_pitch.mid`);

        resolve(midiPath);
      }
    );
  });
}
