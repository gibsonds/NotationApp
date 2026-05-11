# UI guidelines

This file codifies UI conventions for NotationApp. The app is **tablet-first**
(iPad portrait is the design target) and **keyboard-first** (every modal and
list must work with Esc / Enter / arrows). Most of what's here describes
patterns already in the codebase — read a similar existing component before
designing a new one. Coherence beats novelty.

> Update this file when you add a pattern that other components should follow.

## Principles

1. **Tablet-first.** Every control must work with a finger. Touch targets ≥ 44px.
   No hover-only affordances.
2. **Keyboard-first for power users.** Esc closes, Enter commits, ⌘⏎ saves.
   Arrow keys navigate lists when applicable.
3. **Match what's already there.** Before designing, grep `src/components/` for
   a similar pattern and copy its sizing/colors.
4. **One primary action per surface.** Filled blue. Everything else is gray or
   ghost. Two filled-blue buttons in the same view is a smell.
5. **Empty states teach the next move.** "No X yet. Type Y above…" — never
   just "Empty."
6. **Multi-select beats per-row buttons when users act on >5 items.** Don't
   make them tap N times.
7. **No scroll-jail in modals.** Footer actions must be reachable without
   scrolling the body.

## Sizing tokens (from real usage)

- **Modal widths**: small `w-[440px]`, default `w-[560px]`, wide `w-[800px]`.
  Always cap with `max-w-[92vw]`. Don't invent new widths without a reason.
- **Row padding**: top-level `px-5 py-3` (~44–48px tall — meets touch target);
  sub-rows `px-5 py-2`.
- **Modal chrome**: `px-5` on header/footer/body; backdrop `bg-black/40`; z-50
  for primary, z-100 for stacked / nested.
- **Focus ring**: `focus:outline-none focus:ring-2 focus:ring-blue-500` on
  every interactive element.

## Buttons (four styles, no more)

- **Primary (blue, filled)** — main action.
  `px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg`
- **Secondary (gray, ghost)** — Cancel, Close, side actions.
  `px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-100 active:bg-gray-200 rounded-lg`
- **Destructive (red)** — Delete and similar. Always confirm with a preview
  of what's affected.
  `text-red-600 hover:bg-red-50 active:bg-red-100`
- **Ghost / icon-only** — Rename, kebab, close X.
  `p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 active:bg-gray-200 rounded-lg`
  (or `w-11 h-11` for prominent icon buttons; matches the 44px target).

## Empty states

Three lines or fewer. `text-gray-500`. Include the next action inline:

- ✅ "No sets yet. Type a name above to create one — useful for grouping songs you play together at a gig or rehearsal."
- ❌ "No sets found." / "Empty."

## Lists

- One primary tap per row (loads / opens). Secondary actions inline on the
  right (Load button, kebab menu), `shrink-0`.
- Hover: `hover:bg-gray-50`. Active: blue text accent on the title.
- Kebab menus must use `fixed`-positioned popovers — `absolute` popovers
  get clipped by the modal's `overflow-y-auto`.

## Modals

- `fixed inset-0` overlay with `bg-black/40` backdrop. `z-50` for primary;
  stacked sheets at `z-[100]` or `z-[110]`.
- Esc closes (mandatory). Backdrop click closes unless busy/disabled.
- Header pattern: title + ghost X button on the right.
- One filled-blue primary action in the footer; ghost Cancel / Close to its
  left.

## Multi-select mode

When introducing multi-select to a list:

1. Add a `[Select]` toggle ghost button in the header. On = select mode;
   the button label flips to `[Cancel]`.
2. In select mode, rows render with a leading checkbox; the primary tap
   toggles selection instead of loading/opening.
3. Per-row secondary actions (Load button, kebab) hide while in select mode
   so the row is purely selection-focused.
4. A bulk-action bar appears at the bottom of the modal when ≥1 item is
   selected: `"N selected"` on the left; action buttons on the right
   (primary filled-blue for the most common action, ghost for the rest,
   destructive-red for Delete).
5. Esc or `[Cancel]` exits select mode and clears the selection.

## Sheets (modals stacked on modals)

When a sub-action needs a focused decision sheet (e.g. "Add to set"):

- Render at `z-[110]` so it sits above the parent modal's `z-50`.
- Reuse the small-modal styling from `AutosaveRecoveryDialog.tsx` —
  `w-[440px]` to `w-[560px]`, centred near the top of the viewport
  (`pt-[12vh]`).
- Same Esc / backdrop dismissal rules. Body click does NOT close the parent.

## Pre-flight checklist (run BEFORE designing any new component)

1. **Is there an existing component I can extend?** Grep `src/components/`
   for a similar pattern; copy its skeleton.
2. **Does the empty state teach the next action?**
3. **What does keyboard nav look like?** Esc, Enter, arrows where applicable.
4. **Is the primary action visible without scrolling?**
5. **Are touch targets ≥ 44px?**
6. **For lists >5 items, do users need multi-select?**
7. **Does it look right at iPad portrait (≈810×1080)?** Open DevTools at
   that viewport before merging.
