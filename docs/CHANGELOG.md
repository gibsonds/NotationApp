# Changelog

Auto-generated from commits to `main` by `.github/workflows/update-docs.yml`.
Newest entries on top.

## 2026-07-01 — a0d37f4

**Chord charts: touch-first editing (mode toggle + tap-word chord entry) (#169)**

- Commit: [`a0d37f4`](../../commit/a0d37f41bbcde7b9f16a17cb3cd96d76b7ccdc4a)
- Author: gibsonds
- Files changed:
  - `src/components/ChordChartView.tsx`
  - `src/components/PasteLyricsModal.tsx`
  - `src/lib/__tests__/chord-line.test.ts`
  - `src/lib/chord-line.ts`

## 2026-06-30 — 85faaa8

**Force explicit Save into the cloud DB; stop swallowing 409s (#168)**

- Commit: [`85faaa8`](../../commit/85faaa86db4aaf1e9a267a82f6d858641136fb1e)
- Author: gibsonds
- Files changed:
  - `src/components/MySongsModal.tsx`
  - `src/lib/__tests__/cloud-autosave.test.ts`
  - `src/lib/song-cloud.ts`

## 2026-06-30 — f33c240

**Fix disappearing saves: sync race, empty-cloud wipe, silent quota (#167)**

- Commit: [`f33c240`](../../commit/f33c24090dfc3ab52c6851fb24ccb23cad005c72)
- Author: gibsonds
- Files changed:
  - `src/components/MySongsModal.tsx`
  - `src/lib/__tests__/cloud-autosave.test.ts`
  - `src/lib/song-bank.ts`
  - `src/lib/song-cloud.ts`

## 2026-06-22 — f5ecb5b

**Add move_section patch op; merge (not wipe) on songbook join (#166)**

- Commit: [`f5ecb5b`](../../commit/f5ecb5bdb06d041aedc7a44fb0060794580b653e)
- Author: gibsonds
- Files changed:
  - `src/components/ChordChartView.tsx`
  - `src/components/JoinSongbookModal.tsx`
  - `src/components/MySongsModal.tsx`
  - `src/lib/__tests__/cloud-autosave.test.ts`
  - `src/lib/__tests__/patches-reflow.test.ts`
  - `src/lib/ai-provider.ts`
  - `src/lib/patches.ts`
  - `src/lib/schema.ts`
  - `src/lib/song-cloud.ts`

## 2026-06-19 — d034042

**Sync: never tombstone a song with unpushed local edits (#165)**

- Commit: [`d034042`](../../commit/d034042bbdb3ff1f772269c9d0453ea7c6d9ec0d)
- Author: gibsonds
- Files changed:
  - `src/app/page.tsx`
  - `src/lib/__tests__/cloud-autosave.test.ts`
  - `src/lib/cloud-autosave.ts`
  - `src/lib/song-bank.ts`
  - `src/lib/song-cloud.ts`

## 2026-06-18 — d029210

**AI: force JSON via tool_choice so revise/create can't return prose (#164)**

- Commit: [`d029210`](../../commit/d0292108291d9bfc430339f357777542a0b1c010)
- Author: gibsonds
- Files changed:
  - `src/lib/ai-provider.ts`

## 2026-06-18 — f97703e

**Update AI model to claude-sonnet-4-6 (Sonnet 4.0 retired June 15 2026) (#163)**

- Commit: [`f97703e`](../../commit/f97703ecf07d2dfc4fa228f718013cce72c4abf1)
- Author: gibsonds
- Files changed:
  - `.env.local.example`
  - `src/lib/ai-provider.ts`

## 2026-05-27 — 8d85988

**Perform: scroll-mode toggle (bars vs constant) + no-warp on bar-less songs (#162)**

- Commit: [`8d85988`](../../commit/8d85988bcd58516b4592b22496c3ffe70ae0c496)
- Author: gibsonds
- Files changed:
  - `src/components/PerformView.tsx`
  - `src/lib/__tests__/chord-bar-inventory.test.ts`
  - `src/lib/chord-bar-inventory.ts`

## 2026-05-22 — b4499cf

**ConflictModal: per-section diff replaces 'just counts' (#116)**

- Commit: [`b4499cf`](../../commit/b4499cf0a7ab2ec1b737cec228a41833eaf788d8)
- Author: gibsonds
- Files changed:
  - `src/app/page.tsx`
  - `src/components/ConflictModal.tsx`
  - `src/lib/__tests__/conflict-diff.test.ts`
  - `src/lib/conflict-diff.ts`

## 2026-05-21 — 5752a78

**Fix: MySongsModal stacks above PerformView (was z-50 tie) (#158)**

- Commit: [`5752a78`](../../commit/5752a78d4986c1044eaf518b818d1384aa2dcdf9)
- Author: gibsonds
- Files changed:
  - `e2e/perform-toolbar-clicks.spec.ts`
  - `src/components/MySongsModal.tsx`

## 2026-05-21 — 38dfe23

**PerformView: visible "Songs" button in the toolbar (#157)**

- Commit: [`38dfe23`](../../commit/38dfe239a696d8c659d2199fc033aa8d8c8bfb29)
- Author: gibsonds
- Files changed:
  - `src/components/PerformView.tsx`

## 2026-05-20 — 8c9f6ad

**Compare overlay: per-line diff highlighting + 'only diffs' toggle (#156)**

- Commit: [`8c9f6ad`](../../commit/8c9f6ad1e59ab4a56dad2d01cbc71176f3aeadcb)
- Author: gibsonds
- Files changed:
  - `src/components/DuplicateResolver.tsx`
  - `src/lib/__tests__/chord-chart-diff.test.ts`
  - `src/lib/chord-chart-diff.ts`

## 2026-05-20 — 550c204

**Duplicate-song resolver: banner + per-group keep/compare (#154)**

- Commit: [`550c204`](../../commit/550c2047b9b454354b85d9172c14e0a0a0bc8e51)
- Author: gibsonds
- Files changed:
  - `src/components/DuplicateResolver.tsx`
  - `src/components/MySongsModal.tsx`
  - `src/lib/__tests__/song-bank-dedup.test.ts`
  - `src/lib/song-bank.ts`

## 2026-05-20 — 96c86b8

**Persistent reflow: reflow_section patch + section-header command (#151)**

- Commit: [`96c86b8`](../../commit/96c86b87c4e1a5a8a0abf035228c5730c317773b)
- Author: gibsonds
- Files changed:
  - `src/components/ChordChartView.tsx`
  - `src/lib/__tests__/chord-line-wrap.test.ts`
  - `src/lib/__tests__/patches-reflow.test.ts`
  - `src/lib/ai-provider.ts`
  - `src/lib/chord-line-wrap.ts`
  - `src/lib/patches.ts`
  - `src/lib/schema.ts`

## 2026-05-17 — a486af9

**BYOK on the static deploy: AI calls go direct from browser (#147)**

- Commit: [`a486af9`](../../commit/a486af9f426d464b5f8155d560d1851614d0b006)
- Author: gibsonds
- Files changed:
  - `src/components/InlineAIPrompt.tsx`
  - `src/components/PromptPanel.tsx`
  - `src/lib/ai-logger.ts`
  - `src/lib/ai-provider.ts`
  - `src/lib/score-client.ts`

## 2026-05-17 — 336737a

**2-col perform: wrap long lines at bar boundaries (#146)**

- Commit: [`336737a`](../../commit/336737ad58ed58f534987568d88037f8451c3575)
- Author: gibsonds
- Files changed:
  - `src/components/PaginatedPerformChart.tsx`
  - `src/lib/__tests__/chord-line-wrap.test.ts`
  - `src/lib/chord-line-wrap.ts`

## 2026-05-15 — a5ba1ab

**PerformView: tempo override step 2 bpm, no bar jump on change (#145)**

- Commit: [`a5ba1ab`](../../commit/a5ba1ab0f7abab75249121f942d0b91bc6d194d1)
- Author: gibsonds
- Files changed:
  - `src/components/PerformView.tsx`

## 2026-05-15 — a075ce5

**PerformView: always-visible Pause/Continue button + resumable pause (#144)**

- Commit: [`a075ce5`](../../commit/a075ce5d28330d522ea18a56948cc05f44f111b0)
- Author: gibsonds
- Files changed:
  - `src/components/PerformView.tsx`

## 2026-05-15 — 2136aca

**Auto-scroll overshoot fix + out-of-scope title chip (#143)**

- Commit: [`2136aca`](../../commit/2136aca6e3e21311eff3f5dac5aabd63face2ddc)
- Author: gibsonds
- Files changed:
  - `e2e/auto-scroll.spec.ts`
  - `playwright.config.ts`
  - `src/components/PerformView.tsx`

## 2026-05-14 — c868ab9

**Auto-scroll: separate trigger threshold from target position (#142)**

- Commit: [`c868ab9`](../../commit/c868ab9abb75d6c9bd633f52132c1c4e8f8cf536)
- Author: gibsonds
- Files changed:
  - `src/lib/__tests__/perform-scroll.test.ts`
  - `src/lib/perform-scroll.ts`

## 2026-05-14 — 1f9fb69

**Auto-scroll: drop top spacer (keep warmup model) (#141)**

- Commit: [`1f9fb69`](../../commit/1f9fb69ee4f2e34a768ed28623b235f456170e49)
- Author: gibsonds
- Files changed:
  - `src/components/PerformView.tsx`

## 2026-05-14 — 7940808

**Auto-scroll: teleprompter spacers keep active bar at 1/3 (#140)**

- Commit: [`7940808`](../../commit/79408089e734eccffecd3e533157956e1ffbb170)
- Author: gibsonds
- Files changed:
  - `src/components/PerformView.tsx`

## 2026-05-14 — dc0f2a1

**Auto-scroll test harness + helper extraction (#139)**

- Commit: [`dc0f2a1`](../../commit/dc0f2a19df29538cb3bf2c4f4c12d5f2eefd5acd)
- Author: gibsonds
- Files changed:
  - `src/components/PerformView.tsx`
  - `src/lib/__tests__/perform-scroll.test.ts`
  - `src/lib/perform-scroll.ts`

## 2026-05-14 — 76a0baa

**Auto-scroll: animate on line transition, not every frame (#138)**

- Commit: [`76a0baa`](../../commit/76a0baae77b12f16092e9b1775ab071f1c339559)
- Author: gibsonds
- Files changed:
  - `src/components/PerformView.tsx`

## 2026-05-14 — 2777d10

**Position-driven scroll: chord chart follows active bar's line (#137)**

- Commit: [`2777d10`](../../commit/2777d10b460fbd6343f87053eadcea920c1841bd)
- Author: gibsonds
- Files changed:
  - `src/components/PerformView.tsx`

## 2026-05-14 — 8953d6a

**Continuous bar-derived scroll (replace jump-to-line) (#136)**

- Commit: [`8953d6a`](../../commit/8953d6a3511727634a84dbf14e728e1c0e0f4721)
- Author: gibsonds
- Files changed:
  - `src/components/PerformView.tsx`

## 2026-05-14 — 6945509

**Bar inventory: count chord-content edges as implicit bars (#135)**

- Commit: [`6945509`](../../commit/69455094282b99187be7b45cc60f2492559b46f2)
- Author: gibsonds
- Files changed:
  - `src/lib/__tests__/chord-bar-inventory.test.ts`
  - `src/lib/chord-bar-inventory.ts`

## 2026-05-14 — b5b017a

**Auto-scroll: lock scroll to bar transitions + perform-tempo override (#134)**

- Commit: [`b5b017a`](../../commit/b5b017ac53253dcdc5269ac7d57b6f80253c1fff)
- Author: gibsonds
- Files changed:
  - `src/components/ChordChartView.tsx`
  - `src/components/PerformView.tsx`
  - `src/lib/__tests__/chord-bar-inventory.test.ts`
  - `src/lib/chord-bar-inventory.ts`

## 2026-05-14 — 09017ea

**Test: || is a real bar in the inventory (locks behaviour) (#133)**

- Commit: [`09017ea`](../../commit/09017eacc462a38293ffdfb7adbf23586699cd6a)
- Author: gibsonds
- Files changed:
  - `src/lib/__tests__/chord-bar-inventory.test.ts`

## 2026-05-14 — 092fce4

**Auto-scroll: highlight bar-line char only, not whole bar (#132)**

- Commit: [`092fce4`](../../commit/092fce49e01b17894bcf8f0fc6a6fea67734137c)
- Author: gibsonds
- Files changed:
  - `src/components/ChordChartView.tsx`

## 2026-05-14 — 12b5847

**Auto-scroll: green per-bar highlight as bars are 'played' (#131)**

- Commit: [`12b5847`](../../commit/12b58475d084c2bc70ed2eb13ba4aae8822808a6)
- Author: gibsonds
- Files changed:
  - `src/components/ChordChartView.tsx`
  - `src/components/PerformView.tsx`
  - `src/lib/__tests__/chord-bar-inventory.test.ts`
  - `src/lib/chord-bar-inventory.ts`

## 2026-05-14 — a1a1241

**Auto-scroll: tempo-aware speed + big floating PAUSE (#130)**

- Commit: [`a1a1241`](../../commit/a1a1241f62ef17f7aba3991e2bfc1cc1919d97ee)
- Author: gibsonds
- Files changed:
  - `src/components/PerformView.tsx`

## 2026-05-14 — a2a3c13

**File → Import songbook from JSON (Fork / Replace) (#129)**

- Commit: [`a2a3c13`](../../commit/a2a3c134d14a8dd81943a9e0a423017ef6164506)
- Author: gibsonds
- Files changed:
  - `src/app/page.tsx`
  - `src/components/ImportSongbookDialog.tsx`
  - `src/components/MenuBar.tsx`

## 2026-05-14 — 9f71249

**PerformView auto-scroll scaffolding (#23) (#120)**

- Commit: [`9f71249`](../../commit/9f71249ac125df0e864fd46e36924cea3c78e8b1)
- Author: gibsonds
- Files changed:
  - `src/components/PerformView.tsx`

## 2026-05-13 — bd69dc3

**Harden share-code parser + surface Copy code button (#128)**

- Commit: [`bd69dc3`](../../commit/bd69dc381b5c26c377a975253416ad7baa9accf9)
- Author: gibsonds
- Files changed:
  - `src/components/MySongsModal.tsx`
  - `src/lib/__tests__/extract-join-code.test.ts`
  - `src/lib/song-cloud.ts`

## 2026-05-13 — 3b69f13

**File menu: Export all songs (backup) + Reset and pull from cloud (#127)**

- Commit: [`3b69f13`](../../commit/3b69f13e2df3a4585e5117a8c35d1e651be28b8c)
- Author: gibsonds
- Files changed:
  - `src/app/page.tsx`
  - `src/components/MenuBar.tsx`

## 2026-05-13 — 7815808

**File → 'Push all songs to cloud (recovery)' action (#126)**

- Commit: [`7815808`](../../commit/78158081997ec3da8917f1c796a0a2730b19096f)
- Author: gibsonds
- Files changed:
  - `src/app/page.tsx`
  - `src/components/MenuBar.tsx`

## 2026-05-13 — f6175f4

**Type-to-confirm guard on Delete-all-in-folder (#125)**

- Commit: [`f6175f4`](../../commit/f6175f47cb452ea287dd638aa57579be7bda32ff)
- Author: gibsonds
- Files changed:
  - `src/components/MySongsModal.tsx`

## 2026-05-13 — 85e1cea

**Per-folder Export JSON + Delete all (archive workflow) (#124)**

- Commit: [`85e1cea`](../../commit/85e1cea791e0f25083242889281e439bf98e4025)
- Author: gibsonds
- Files changed:
  - `src/components/MySongsModal.tsx`

## 2026-05-13 — 66e4fb4

**MySongsModal right-pane redesign: fewer modals, bigger surface (#123)**

- Commit: [`66e4fb4`](../../commit/66e4fb4710b4dc7b4c72d5519243dc0fe72456ce)
- Author: gibsonds
- Files changed:
  - `src/components/AddToSetSheet.tsx`
  - `src/components/MySongsModal.tsx`
  - `src/components/PerformView.tsx`
  - `src/components/SetsPanel.tsx`
  - `src/lib/__tests__/song-bank-aliases.test.ts`
  - `src/lib/song-bank.ts`

## 2026-05-12 — b1c3e02

**Sets + AddToSet quick wins: folder pill, canonical search, inline +Add (#122)**

- Commit: [`b1c3e02`](../../commit/b1c3e02634ac39452b9b34a3d513afad2a6b314e)
- Author: gibsonds
- Files changed:
  - `src/components/AddToSetSheet.tsx`
  - `src/components/SetsPanel.tsx`
  - `src/lib/__tests__/add-to-set-flow.test.ts`
  - `src/lib/song-sets.ts`

## 2026-05-12 — cfe495e

**Fix Rename / kebab menu: clicks were closing the whole modal (#121)**

- Commit: [`cfe495e`](../../commit/cfe495ed81b25421e817eb125caf697c398975b5)
- Author: gibsonds
- Files changed:
  - `src/components/MySongsModal.tsx`

## 2026-05-12 — 4e1c28a

**PerformView: 'Switch to set' chips in the song picker (#119)**

- Commit: [`4e1c28a`](../../commit/4e1c28a874e7bbfc86985cc4f19140721daa19cb)
- Author: gibsonds
- Files changed:
  - `src/components/PerformView.tsx`

## 2026-05-12 — f2025bb

**My Songs search box (canonical-title substring match) (#118)**

- Commit: [`f2025bb`](../../commit/f2025bb9b95e101905922443f554b7824246841e)
- Author: gibsonds
- Files changed:
  - `src/components/MySongsModal.tsx`

## 2026-05-12 — e356db9

**Extract songSetMembership into song-sets.ts (#117)**

- Commit: [`e356db9`](../../commit/e356db937904774f2034ae72dc59eaa4034c764b)
- Author: gibsonds
- Files changed:
  - `src/components/MySongsModal.tsx`
  - `src/lib/__tests__/song-set-membership.test.ts`
  - `src/lib/song-sets.ts`

## 2026-05-12 — 2f13d44

**'In N sets' badge on My Songs rows (#115)**

- Commit: [`2f13d44`](../../commit/2f13d4436056aa8811bb3fe034a4aa0fa2e440a4)
- Author: gibsonds
- Files changed:
  - `src/components/MySongsModal.tsx`

## 2026-05-12 — 66dfaae

**Extract AddToSet candidate filter + add behavior tests (#114)**

- Commit: [`66dfaae`](../../commit/66dfaae3da8e1f89cde3608d3bbb23232146f8dd)
- Author: gibsonds
- Files changed:
  - `src/components/AddToSetSheet.tsx`
  - `src/lib/__tests__/add-to-set-flow.test.ts`
  - `src/lib/song-sets.ts`

## 2026-05-12 — 0c270af

**Unified Unicode-aware title canonicalization (#113)**

- Commit: [`0c270af`](../../commit/0c270af4f37cff2ad693085a2b8148d06004202e)
- Author: gibsonds
- Files changed:
  - `src/components/AutosaveRecoveryDialog.tsx`
  - `src/components/MySongsModal.tsx`
  - `src/lib/__tests__/canonical-title.test.ts`
  - `src/lib/song-bank.ts`

## 2026-05-12 — 4f2e641

**UI guidelines doc + Sets/My Songs redesign (multi-select) (#112)**

- Commit: [`4f2e641`](../../commit/4f2e641cd4273711320c86fa4e136c18a68995ea)
- Author: gibsonds
- Files changed:
  - `AGENTS.md`
  - `docs/ui-guidelines.md`
  - `src/components/AddToSetSheet.tsx`
  - `src/components/MySongsModal.tsx`
  - `src/components/SetsPanel.tsx`

## 2026-05-12 — ca28cea

**Annotation fixes: visible textarea + drag-to-move (#111)**

- Commit: [`ca28cea`](../../commit/ca28cea64c61cc5c5457aeca8ba583d9dcac061e)
- Author: gibsonds
- Files changed:
  - `src/components/AnnotationLayer.tsx`
  - `src/components/AnnotationPopover.tsx`
  - `src/lib/schema.ts`

## 2026-05-10 — 01ff5e3

**Hide alias artifacts from Sets picker + 'Clean up aliases' action (#110)**

- Commit: [`01ff5e3`](../../commit/01ff5e3a351d759f76038806cc54859a24b36277)
- Author: gibsonds
- Files changed:
  - `src/components/MySongsModal.tsx`
  - `src/components/SetsPanel.tsx`
  - `src/lib/__tests__/song-bank-aliases.test.ts`
  - `src/lib/song-bank.ts`

## 2026-05-10 — 665160b

**Sets feature (#73): group songs into ordered set lists (#109)**

- Commit: [`665160b`](../../commit/665160b87b35cc8f60dd6d9b89eb88c1ac91c1ab)
- Author: gibsonds
- Files changed:
  - `src/components/MySongsModal.tsx`
  - `src/components/PerformView.tsx`
  - `src/components/SetsPanel.tsx`
  - `src/lib/__tests__/song-sets.test.ts`
  - `src/lib/song-sets.ts`
  - `src/store/score-store.ts`

## 2026-05-10 — 9f7214c

**Cloud-sync test coverage with happy-dom + fetch mocking (#108)**

- Commit: [`9f7214c`](../../commit/9f7214c2a6baa2a9b4b5a47f12db585d7ccda2e4)
- Author: gibsonds
- Files changed:
  - `package-lock.json`
  - `package.json`
  - `src/lib/__tests__/cloud-autosave.test.ts`
  - `vitest.config.ts`

## 2026-05-09 — 2205993

**Tombstone-based deletion in syncSongbook (#101)**

- Commit: [`2205993`](../../commit/22059936bed1d04054e1804d657d24344ee32eb9)
- Author: gibsonds
- Files changed:
  - `src/lib/song-cloud.ts`

## 2026-05-09 — 7f5e79c

**Clean up duplicates: keep the richest copy, not just the newest (#107)**

- Commit: [`7f5e79c`](../../commit/7f5e79c9409f1773025d55a5587b0991bef4fa8d)
- Author: gibsonds
- Files changed:
  - `src/components/MySongsModal.tsx`

## 2026-05-09 — ac6b175

**Bulk-recover: normalize titles fully so near-duplicates don't sneak through (#106)**

- Commit: [`ac6b175`](../../commit/ac6b175587b629174427827dd56ac8bbd2a65490)
- Author: gibsonds
- Files changed:
  - `src/components/AutosaveRecoveryDialog.tsx`

## 2026-05-09 — ccfc473

**Phase 3 of #89: auto-merge on 409 (cloud-autosave path) (#100)**

- Commit: [`ccfc473`](../../commit/ccfc47394abacf9f77e07b8f71c8de075e4d76bf)
- Author: gibsonds
- Files changed:
  - `src/app/page.tsx`
  - `src/lib/cloud-autosave.ts`

## 2026-05-09 — a951da5

**Save Song: explicit branching when title differs from current entry (#104)**

- Commit: [`a951da5`](../../commit/a951da52fe5e9b516b7e6bf19c30f34eb27ef95e)
- Author: gibsonds
- Files changed:
  - `src/components/MySongsModal.tsx`

## 2026-05-09 — d57ae83

**Account for per-block margins when packing 2-col perform pages (#103)**

- Commit: [`d57ae83`](../../commit/d57ae83cfad0840137cf6403822a05ae5dc4b396)
- Author: gibsonds
- Files changed:
  - `src/components/PaginatedPerformChart.tsx`

## 2026-05-09 — 6d55ff4

**Phase 1+2 of #89: score-merge.ts + annotation-merge.ts + tests (#99)**

- Commit: [`6d55ff4`](../../commit/6d55ff4b0029ed8a288dea5cffb79f5fc9b14d5f)
- Author: gibsonds
- Files changed:
  - `package-lock.json`
  - `package.json`
  - `src/lib/__tests__/annotation-merge.test.ts`
  - `src/lib/__tests__/score-merge.test.ts`
  - `src/lib/annotation-merge.ts`
  - `src/lib/score-merge.ts`
  - `vitest.config.ts`

## 2026-05-09 — cb5e314

**Fix bottom-cutoff in 2-column perform mode (#98)**

- Commit: [`cb5e314`](../../commit/cb5e31492dba413fe280e4f5fcdf44e2e7e3aaaf)
- Author: gibsonds
- Files changed:
  - `src/components/PaginatedPerformChart.tsx`

## 2026-05-08 — 3331078

**Three-tab perform picker: Unfiled / folders / All (#97)**

- Commit: [`3331078`](../../commit/33310787165f76ada8de81b80c79583ea9595d49)
- Author: gibsonds
- Files changed:
  - `src/components/PerformView.tsx`

## 2026-05-08 — bf0bee8

**Add Unfiled tab to perform-mode song picker (#96)**

- Commit: [`bf0bee8`](../../commit/bf0bee858db4d0b8910d6c17a9f154cd5706628c)
- Author: gibsonds
- Files changed:
  - `src/components/PerformView.tsx`

## 2026-05-08 — 603412b

**Perform-mode picker hides folders collapsed in My Songs (#95)**

- Commit: [`603412b`](../../commit/603412b5a337d1c613a34d43703e210b00f195a2)
- Author: gibsonds
- Files changed:
  - `src/components/PerformView.tsx`

## 2026-05-08 — 46282c4

**Run sync after Clean up duplicates so merged cloud content lands (#94)**

- Commit: [`46282c4`](../../commit/46282c4ee0ffcd649951f5b5df30c9d61d97b695)
- Author: gibsonds
- Files changed:
  - `src/components/MySongsModal.tsx`

## 2026-05-08 — 4d62bef

**Sync perform-mode song picker with My Songs via SongsUpdatedEvent (#93)**

- Commit: [`4d62bef`](../../commit/4d62bef444aa2b8acc46c2f3a2fb6f6cc1306f13)
- Author: gibsonds
- Files changed:
  - `src/components/PerformView.tsx`
  - `src/lib/song-bank.ts`

## 2026-05-08 — dccfe91

**Refresh perform-mode song picker on open (#92)**

- Commit: [`dccfe91`](../../commit/dccfe9132b87b23f57a2f614ba480e506ccee903)
- Author: gibsonds
- Files changed:
  - `src/components/PerformView.tsx`

## 2026-05-08 — 03c03fd

**Tier 1: cloud versioning + 409 conflict modal (#87) (#90)**

- Commit: [`03c03fd`](../../commit/03c03fd2599d003dbb57295fc33f57759a892084)
- Author: gibsonds
- Files changed:
  - `infra/lambda/handler.ts`
  - `infra/lambda/repo.ts`
  - `infra/lambda/types.ts`
  - `src/app/page.tsx`
  - `src/components/ConflictModal.tsx`
  - `src/components/MySongsModal.tsx`
  - `src/lib/cloud-autosave.ts`
  - `src/lib/song-bank.ts`
  - `src/lib/song-cloud-types.ts`
  - `src/lib/song-cloud.ts`

## 2026-05-08 — f03283e

**My Songs: refresh open editor when cloud has newer content (#86)**

- Commit: [`f03283e`](../../commit/f03283ef5667a70072086bbe999e8613dc38cf02)
- Author: gibsonds
- Files changed:
  - `src/components/MySongsModal.tsx`

## 2026-05-08 — fdd88c9

**Score CLI thin slice (#19) (#85)**

- Commit: [`fdd88c9`](../../commit/fdd88c990083288a6b9108ca35fd441361fb8c0c)
- Author: gibsonds
- Files changed:
  - `bin/notation`
  - `bin/notation.ts`
  - `package-lock.json`
  - `package.json`

## 2026-05-08 — f7a2b9a

**iPad chord-chart: bigger touch targets on coarse pointer (#23) (#84)**

- Commit: [`f7a2b9a`](../../commit/f7a2b9a7f8f1c4c313e549bb263ddf690257a664)
- Author: gibsonds
- Files changed:
  - `.gitignore`
  - `src/app/globals.css`

## 2026-05-08 — 7991714

**Print: Legal + Tabloid page sizes; @page size honors choice (#5) (#83)**

- Commit: [`7991714`](../../commit/79917142a2f3a37d501b93116da42057251f7e2d)
- Author: gibsonds
- Files changed:
  - `.claude/scheduled_tasks.lock`
  - `src/app/page.tsx`
  - `src/components/PropertiesPanel.tsx`
  - `src/store/score-store.ts`

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

