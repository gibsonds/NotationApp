import { NextRequest, NextResponse } from "next/server";
import { ScoreSchema } from "@/lib/schema";
import { scoreToMusicXML } from "@/lib/musicxml";
import { scoreToMidi } from "@/lib/midi";

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
            "Content-Type": "application/xml",
            "Content-Disposition": `attachment; filename="${scoreResult.data.title || "score"}.musicxml"`,
          },
        });
      }

      case "midi": {
        const midiBytes = scoreToMidi(scoreResult.data);
        return new NextResponse(midiBytes.buffer as ArrayBuffer, {
          headers: {
            "Content-Type": "audio/midi",
            "Content-Disposition": `attachment; filename="${scoreResult.data.title || "score"}.mid"`,
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
  } catch (err: any) {
    console.error("Score export error:", err);
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}
