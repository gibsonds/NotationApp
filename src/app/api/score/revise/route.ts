import { NextRequest, NextResponse } from "next/server";
import { createProvider } from "@/lib/ai-provider";
import { Score, ScoreSchema } from "@/lib/schema";
import { applyPatch } from "@/lib/patches";
import { validateScore } from "@/lib/validation";
import { NoteSelection } from "@/lib/transforms";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { prompt, currentScore, selection, selectedNote } = body as {
      prompt: string;
      currentScore: unknown;
      selection?: NoteSelection;
      selectedNote?: string;
    };

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'prompt' field" },
        { status: 400 }
      );
    }

    if (!currentScore) {
      return NextResponse.json(
        { error: "Missing 'currentScore' field" },
        { status: 400 }
      );
    }

    // Parse current score leniently — it comes from our own store and may have
    // fields from AI responses or schema evolution. Use parsed result if valid,
    // otherwise trust the raw input from our client.
    const scoreResult = ScoreSchema.safeParse(currentScore);
    const score: Score = scoreResult.success
      ? scoreResult.data
      : (currentScore as Score);

    if (!scoreResult.success) {
      console.warn(
        "Score validation warnings (proceeding with raw input):",
        scoreResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
      );
    }

    // Augment prompt with selection context
    let augmentedPrompt = prompt;
    if (selection) {
      const range =
        selection.startMeasure === selection.endMeasure
          ? `measure ${selection.startMeasure}`
          : `measures ${selection.startMeasure}-${selection.endMeasure}`;
      const staffNote = selection.staffIds
        ? ` on staves: ${selection.staffIds.join(", ")}`
        : "";
      const noteInfo = selectedNote ? ` (selected note: ${selectedNote})` : "";
      augmentedPrompt = `[SELECTION: ${range}${staffNote}${noteInfo}] ${prompt}`;
    } else if (selectedNote) {
      augmentedPrompt = `[SELECTED NOTE: ${selectedNote}] ${prompt}`;
    }

    const provider = createProvider();
    const { patches, message } = await provider.reviseScoreFromPrompt(
      augmentedPrompt,
      score,
      selection
    );

    // Apply patches
    let updatedScore = score;
    for (const patch of patches) {
      updatedScore = applyPatch(updatedScore, patch);
    }

    // Validate result
    const validation = validateScore(updatedScore);

    return NextResponse.json({
      score: updatedScore,
      patches,
      message,
      warnings: validation.warnings,
    });
  } catch (err: any) {
    console.error("Score revise error:", err);
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}
