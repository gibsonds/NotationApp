# Changelog

Auto-generated from commits to `main` by `.github/workflows/update-docs.yml`.
Newest entries on top.

## 2026-05-08 — 2d18ace

**Mid-score tempo / time-sig / key-sig changes (#42) (#82)**

- Commit: [`2d18ace`](../../commit/2d18acea5e35ba7ac83acf96669b68cdb6401a86)
- Author: gibsonds
- Files changed:
  - `src/app/page.tsx`
  - `src/components/MenuBar.tsx`
  - `src/components/NewScoreDialog.tsx`
  - `src/components/PropertiesPanel.tsx`
  - `src/components/Toolbar.tsx`
  - `src/lib/chordpro-import.ts`
  - `src/lib/importers/midi-import.ts`
  - `src/lib/importers/musicxml-import.ts`
  - `src/lib/importers/staffpad.ts`
  - `src/lib/musicxml.ts`
  - `src/lib/patches.ts`
  - `src/lib/schema.ts`
  - `src/lib/validation.ts`

## 2026-05-08 — 90c7758

**Ledger line width: multiply OSMD's default, not staff width (#81)**

- Commit: [`90c7758`](../../commit/90c7758a2f800c565fe9ac0733aaf56b8bc41c4c)
- Author: gibsonds
- Files changed:
  - `src/components/ScoreRenderer.tsx`
  - `src/store/score-store.ts`

## 2026-05-08 — 2637a13

**Make ledger lines noticeably bolder (#80)**

- Commit: [`2637a13`](../../commit/2637a135dae4bbefbe77826840699ad6559db962)
- Author: gibsonds
- Files changed:
  - `src/app/globals.css`
  - `src/components/PropertiesPanel.tsx`
  - `src/store/score-store.ts`

## 2026-05-08 — 324a0db

**Add screenshot upload to feedback form**

- Commit: [`324a0db`](../../commit/324a0db0855b7e28410c33649c9c4b9eebac16e7)
- Author: gibsonds
- Files changed:
  - `src/components/FeedbackModal.tsx`
  - `src/lib/feedback-store.ts`

## 2026-05-07 — 9c7a24d

**Add ledger line weight setting; default ledger lines to staff width**

- Commit: [`9c7a24d`](../../commit/9c7a24d0ad0f5631ff2cbfa108656a8d0f60f391)
- Author: gibsonds
- Files changed:
  - `src/components/PropertiesPanel.tsx`
  - `src/components/ScoreRenderer.tsx`
  - `src/store/score-store.ts`

## 2026-05-07 — 3aa3ca1

**fix: apply basePath to MenuBar docs links so they resolve on Pages (#79)**

- Commit: [`3aa3ca1`](../../commit/3aa3ca11c54153c179c7f26f9f82cbc9a346377a)
- Author: gibsonds
- Files changed:
  - `src/components/MenuBar.tsx`

## 2026-05-07 — 357e1bf

**docs: rewrite chord how-to for songwriter "lyrics already loaded" flow (#78)**

- Commit: [`357e1bf`](../../commit/357e1bfe69f0d040c328562482812d309fa7d665)
- Author: gibsonds
- Files changed:
  - `src/app/docs/page.tsx`

## 2026-05-07 — e752d2f

**docs: How To — add chords above lyrics (with visual) (#77)**

- Commit: [`e752d2f`](../../commit/e752d2f7705554b9c678532f63290daac9560c10)
- Author: gibsonds
- Files changed:
  - `src/app/docs/page.tsx`

## 2026-05-07 — 4d8b286

**My Songs: badge each entry as Score / Chart, accept both (#72)**

- Commit: [`4d8b286`](../../commit/4d8b286d4efcbee4a62f927a541c395d3260211b)
- Author: gibsonds
- Files changed:
  - `src/components/MySongsModal.tsx`

## 2026-05-07 — a54c004

**Move audio transcribe to dev/audio-transcribe branch (#71)**

- Commit: [`a54c004`](../../commit/a54c0045a9ee25cfbf77f50f5b22f2e1680c3770)
- Author: gibsonds
- Files changed:
  - `src/app/api/score/transcribe/route.ts`
  - `src/app/docs/page.tsx`
  - `src/components/MenuBar.tsx`
  - `src/components/Toolbar.tsx`

## 2026-05-07 — 325bfb3

**Fix infinite update loop in PaginatedPerformChart (#70)**

- Commit: [`325bfb3`](../../commit/325bfb3844f85be5c990b6ac8a2310575397d2ed)
- Author: gibsonds
- Files changed:
  - `src/components/PaginatedPerformChart.tsx`

## 2026-05-07 — f25a45c

**Merge main: adopt Annotate-as-overlay model (#64, #66)**

- Commit: [`f25a45c`](../../commit/f25a45c2a8d93670eba73c735a4093696da7547d)
- Author: gibsonds
- Files changed:
  - `src/app/page.tsx`
  - `src/components/AnnotateToggle.tsx`
  - `src/components/AnnotationFilterBar.tsx`
  - `src/components/AnnotationLayer.tsx`
  - `src/components/MenuBar.tsx`
  - `src/components/ModeSelector.tsx`
  - `src/components/PaginatedPerformChart.tsx`
  - `src/components/PerformView.tsx`
  - `src/components/ScoreRenderer.tsx`
  - `src/store/score-store.ts`

