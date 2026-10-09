# Entry and songbook usability review — October 2026

## Fixed in this pass

- Exact character placement for chords, including inside words.
- Keyboard focus on chart lines, column navigation, chord/bar navigation across sections, explicit delete, undo, and focus returning to the line after entry.
- Preserve existing chords/bars when an empty draft is abandoned or the user simply visits adjacent tokens.
- Pass recent same-song conversation to the AI, including the assistant's clarification, so follow-ups such as “update both” have their referent.
- Wrap printed chord/lyric columns together at word boundaries within the actual print column width.
- Isolate authenticated song lists, editor drafts, offline queues, sets, and recovery backups by account and songbook. Switching reloads into that book's saved draft.
- New book, join, and viewer/editor invitation controls. Show active book alongside the account.

## Suggested next improvements, in order

1. **Direct lyric editing with a visible caret.** Enter should split a line at the caret; Backspace at the start should join with the previous line, preserving chord anchors. The current double-click entry and Enter-to-split behavior should be reachable from the same chart keyboard flow, without switching between unrelated editing modes.
2. **One compact contextual toolbar.** Chord charts should prioritize chord, lyric, bar, section, and print actions. Hide notation-specific MIDI/note-duration controls when they do not apply. Move the long shortcut paragraph into expandable help with a short reminder for the current mode.
3. **Print preview that matches the output.** Show paper size, columns, font size, and page breaks before opening the browser print dialog. Add a “fit comfortably” preset and preserve song text while wrapping it automatically.
4. **A chart command palette.** Searchable commands for next section, insert line, duplicate chorus, rename section, and repeat markers, with shortcuts displayed alongside commands.
5. **Clear saving and book ownership.** Keep book name and local/cloud save state visible. A viewer should see “view only” immediately and be offered an explicit personal copy rather than discovering permissions after trying to save.
6. **AI change previews.** Show the affected sections and exact line edits, with one-step undo. If two repeated sections match, offer explicit “both sections” and section-specific choices that retain the proposed edit.

## Current limits

- Set lists are separated by songbook on this device; set-list cloud sync is not implemented.
- Browser cache separation prevents accidental cross-book writes; backend membership/role checks enforce access to cloud data.
- Live OAuth42 sign-in and importing the user's real Sleepwalking song require completing the browser's blocked authorization redirect. Mocked browser tests do not replace that live check.
