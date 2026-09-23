/**
 * Which riffs are shown inline in perform mode.
 *
 * A riff of a bar or two is what you glance at mid-song, and a tap to open
 * a card is one tap too many with a guitar in your hands. Those are drawn
 * inline under their line, with a Hide button; anything longer stays a
 * chip that opens the peek card, since a long stave inline would push the
 * chart around and defeat auto-scroll.
 */

import type { Riff } from "@/lib/schema";

export const INLINE_MAX_BARS = 2;
export const INLINE_MAX_EVENTS = 16;

export function isSmallRiff(riff: Pick<Riff, "bars">): boolean {
  if (riff.bars.length === 0 || riff.bars.length > INLINE_MAX_BARS) return false;
  const events = riff.bars.reduce((n, b) => n + b.events.length, 0);
  return events > 0 && events <= INLINE_MAX_EVENTS;
}

/** Inline by default in perform mode unless the user hid it. */
export function showsInline(
  riff: Pick<Riff, "id" | "bars">,
  hiddenIds: readonly string[] | undefined,
): boolean {
  // `hiddenIds` can be undefined on state persisted before the field existed.
  return isSmallRiff(riff) && !(hiddenIds ?? []).includes(riff.id);
}
