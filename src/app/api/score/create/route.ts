import { NextRequest, NextResponse } from "next/server";
import { createProvider, byokFromHeaders } from "@/lib/ai-provider";
import { expandIntentToScore, validateScore, validateScoreIntent } from "@/lib/validation";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { prompt } = body;

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'prompt' field" },
        { status: 400 }
      );
    }

    const provider = createProvider(byokFromHeaders(req.headers));
    const { intent, message } = await provider.createScoreFromPrompt(prompt);

    // Validate intent schema
    const intentValidation = validateScoreIntent(intent);
    if (!intentValidation.valid) {
      return NextResponse.json(
        {
          error: "AI generated invalid score structure",
          details: intentValidation.errors,
        },
        { status: 422 }
      );
    }

    // Expand intent to full score
    const score = expandIntentToScore(intent);

    // Validate musical sanity
    const validation = validateScore(score);

    return NextResponse.json({
      score,
      message,
      warnings: [
        ...intentValidation.warnings,
        ...validation.warnings,
      ],
    });
  } catch (err: any) {
    console.error("Score create error:", err);
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}
