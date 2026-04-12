import { NextRequest, NextResponse } from "next/server";
import { parseSNT } from "@/lib/importers/staffpad";
import { parseMidi } from "@/lib/importers/midi-import";
import { validateScore } from "@/lib/validation";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "No file uploaded" },
        { status: 400 }
      );
    }

    const filename = file.name.toLowerCase();
    const buffer = await file.arrayBuffer();

    let score;

    if (filename.endsWith(".snt")) {
      score = await parseSNT(buffer);
    } else if (filename.endsWith(".mid") || filename.endsWith(".midi")) {
      try {
        score = parseMidi(buffer);
      } catch (midiErr: any) {
        // Return debug info so the user can see what's happening
        const { Midi } = await import("@tonejs/midi");
        const uint8 = new Uint8Array(buffer);
        const midi = new Midi(uint8);
        const trackInfo = midi.tracks.map((t, i) => ({
          index: i,
          name: t.name,
          notes: t.notes.length,
          instrument: t.instrument?.name,
        }));
        return NextResponse.json(
          {
            error: `MIDI import failed: ${midiErr.message}`,
            debug: {
              fileSize: buffer.byteLength,
              headerName: midi.header.name,
              totalTracks: midi.tracks.length,
              tracks: trackInfo,
              tempos: midi.header.tempos.length,
              timeSignatures: midi.header.timeSignatures.length,
            },
          },
          { status: 500 }
        );
      }
    } else if (
      filename.endsWith(".musicxml") ||
      filename.endsWith(".mxl") ||
      filename.endsWith(".xml")
    ) {
      // MusicXML parsing needs DOMParser (browser API)
      // Return raw XML for client-side parsing
      const text = new TextDecoder().decode(buffer);
      return NextResponse.json({
        format: "musicxml",
        rawXml: text,
        message: "MusicXML file received. Parse client-side.",
      });
    } else {
      return NextResponse.json(
        {
          error: `Unsupported file format: ${filename.split(".").pop()}. Supported: .mid, .midi, .snt, .musicxml`,
        },
        { status: 400 }
      );
    }

    // Infer title from filename if not set
    if (score.title === "Imported Score" || score.title === "Piano") {
      const name = file.name.replace(/\.[^.]+$/, "").replace(/([A-Z])/g, " $1").trim();
      score = { ...score, title: name };
    }

    const validation = validateScore(score);

    return NextResponse.json({
      score,
      message: `Imported ${file.name} successfully.`,
      warnings: validation.warnings,
    });
  } catch (err: any) {
    console.error("Import error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to import file" },
      { status: 500 }
    );
  }
}
