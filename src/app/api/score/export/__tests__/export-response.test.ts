// @vitest-environment node
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";
import { ScoreSchema } from "@/lib/schema";
import { scoreToMidi } from "@/lib/midi";

const score = ScoreSchema.parse({
  id: "export-fixture",
  title: "Warmup & study",
  measures: 1,
  staves: [{
    id: "piano",
    name: "Piano",
    clef: "treble",
    voices: [{
      id: "melody",
      notes: [{ pitch: "C4", duration: "quarter", measure: 1, beat: 1 }],
    }],
  }],
});

function exportRequest(format: string, title = score.title) {
  return new NextRequest("http://localhost/api/score/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format, score: { ...score, title } }),
  });
}

describe("score export responses", () => {
  it("downloads valid MusicXML as inert bytes with the intended extension", async () => {
    const response = await POST(exportRequest("musicxml"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="Warmup _ study.musicxml"; filename*=UTF-8\'\'Warmup%20%26%20study.musicxml'
    );
    const xml = await response.text();
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("<work-title>Warmup &amp; study</work-title>");
    expect(xml).toContain("<step>C</step>");
    expect(xml).toContain("</score-partwise>");
  });

  it("preserves international titles through the encoded filename parameter", async () => {
    const response = await POST(exportRequest("musicxml", "Café étude"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="Caf_ _tude.musicxml"; filename*=UTF-8\'\'Caf%C3%A9%20%C3%A9tude.musicxml'
    );
    expect(await response.text()).toContain("<work-title>Café étude</work-title>");
  });

  it("keeps filename formatting bounded and separate from header syntax", async () => {
    const response = await POST(exportRequest("musicxml", '  Band / rehearsal "B"  '));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="Band _ rehearsal _B_.musicxml"; filename*=UTF-8\'\'Band%20_%20rehearsal%20%22B%22.musicxml'
    );
    const longResponse = await POST(exportRequest("musicxml", "Study ".repeat(40)));
    const disposition = longResponse.headers.get("content-disposition")!;
    expect(disposition.match(/filename="([^"]+)"/)?.[1].length).toBeLessThanOrEqual(129);
  });

  it("uses the score fallback name for an empty title", async () => {
    const response = await POST(exportRequest("musicxml", ""));
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="score.musicxml"; filename*=UTF-8\'\'score.musicxml'
    );
  });

  it("trims filename edges within the bounded title", async () => {
    const response = await POST(exportRequest("musicxml", " . Warmup . "));
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="Warmup.musicxml"; filename*=UTF-8\'\'Warmup.musicxml'
    );
  });

  it("keeps MIDI bytes and type while applying safe attachment headers", async () => {
    const response = await POST(exportRequest("midi"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/midi");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toContain('filename="Warmup _ study.mid"');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(scoreToMidi(score));
  });

  it("preserves JSON export and validation responses", async () => {
    const response = await POST(exportRequest("json"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(await response.json()).toEqual(score);
    expect((await POST(exportRequest("unsupported"))).status).toBe(400);
    const invalid = new NextRequest("http://localhost/api/score/export", {
      method: "POST",
      body: JSON.stringify({ format: "musicxml", score: {} }),
    });
    expect((await POST(invalid)).status).toBe(400);
  });
});
