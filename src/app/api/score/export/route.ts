import { NextRequest, NextResponse } from "next/server";
import { ScoreSchema } from "@/lib/schema";
import { scoreToMusicXML } from "@/lib/musicxml";
import { scoreToMidi } from "@/lib/midi";

function attachmentName(title: string, extension: "musicxml" | "mid"): string {
  // Keep a bounded basename, never path segments or control characters. The
  // ASCII fallback is quoted safely; filename* preserves international titles.
  const bounded = title
    .replace(/[\p{Cc}\/\\]/gu, "_")
    .slice(0, 120)
    .toWellFormed();
  let first = 0;
  let last = bounded.length;
  while (first < last && (bounded[first] === "." || bounded[first].trim() === "")) first++;
  while (last > first && (bounded[last - 1] === "." || bounded[last - 1].trim() === "")) last--;
  const stem = bounded.slice(first, last) || "score";
  const fallback = stem.replace(/[^A-Za-z0-9 ._-]/g, "_");
  const encoded = encodeURIComponent(`${stem}.${extension}`).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="${fallback}.${extension}"; filename*=UTF-8''${encoded}`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { score, format } = body;

    if (!score) {
      return NextResponse.json(
        { error: "Missing 'score' field" },
        { status: 400 }
      );
    }

    const scoreResult = ScoreSchema.safeParse(score);
    if (!scoreResult.success) {
      return NextResponse.json(
        { error: "Invalid score", details: scoreResult.error.issues },
        { status: 400 }
      );
    }

    switch (format) {
      case "musicxml": {
        const xml = scoreToMusicXML(scoreResult.data);
        return new NextResponse(xml, {
          headers: {
            // This endpoint exports a file, not an active XML document to render.
            "Content-Type": "application/octet-stream",
            "Content-Disposition": attachmentName(scoreResult.data.title, "musicxml"),
            "X-Content-Type-Options": "nosniff",
          },
        });
      }

      case "midi": {
        const midiBytes = scoreToMidi(scoreResult.data);
        return new NextResponse(midiBytes.buffer as ArrayBuffer, {
          headers: {
            "Content-Type": "audio/midi",
            "Content-Disposition": attachmentName(scoreResult.data.title, "mid"),
            "X-Content-Type-Options": "nosniff",
          },
        });
      }

      case "json": {
        return NextResponse.json(scoreResult.data);
      }

      default:
        return NextResponse.json(
          { error: `Unsupported format: ${format}. Supported: musicxml, midi, json` },
          { status: 400 }
        );
    }
  } catch (err: unknown) {
    console.error("Score export error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
