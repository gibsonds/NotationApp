"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import Link from "next/link";

type Section = {
  id: string;
  title: string;
  body: React.ReactNode;
};

const SECTIONS: Section[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    body: (
      <>
        <p>
          NotationApp is an AI-native, browser-based music notation tool. Describe music in
          plain English, paste in chord charts, sketch with the on-screen keyboard, or import
          MIDI/MusicXML and get an editable score back.
        </p>
        <h3>First steps</h3>
        <ol>
          <li>Open the app — if no score is loaded, click <em>New Score</em> for staff
          notation, or <em>New Chord Chart</em> for a lyrics-and-chords song.</li>
          <li>Open the sidebar with <Kbd>Cmd&nbsp;B</Kbd> to reveal the AI Assistant and
          Properties drawers.</li>
          <li>Click any beat on the staff to drop the cursor, then type notes (<Kbd>A</Kbd>–<Kbd>G</Kbd>)
          or play a connected MIDI keyboard.</li>
          <li>Use <em>File → My Songs</em> to save your work to the local song bank (and
          to the cloud if it&apos;s configured).</li>
        </ol>
        <h3>The three modes</h3>
        <p>
          The mode selector at the top center of the menu bar switches between
          <strong> Edit</strong> (full editing UI), <strong>Perform</strong> (clean, full-screen
          view for playing), and <strong>Annotate</strong> (sticky-note overlay).
        </p>
      </>
    ),
  },
  {
    id: "edit-mode",
    title: "Edit Mode",
    body: (
      <>
        <p>
          Edit mode is the default. The score sits in the center, the sidebar holds AI and
          properties panels, and a status bar runs along the bottom.
        </p>
        <h3>Entering notes</h3>
        <ul>
          <li>Click an empty beat to place the cursor.</li>
          <li>Type <Kbd>A</Kbd>–<Kbd>G</Kbd> to add a note at the cursor; the cursor advances
          to the next beat.</li>
          <li>Use the on-screen MIDI keyboard at the bottom of the screen, or play a connected
          MIDI device.</li>
          <li>Press <Kbd>L</Kbd> to enter lyric mode — type words under the highlighted note,
          space advances to the next note.</li>
          <li>Right-click a note for the context menu (change duration, edit with AI, delete).</li>
        </ul>
        <h3>Key signature, time signature, tempo</h3>
        <p>
          Open the <em>Properties</em> drawer in the sidebar to change key, time signature,
          tempo, number of measures, anacrusis (pickup bar), and more. Changes apply immediately
          and are undoable.
        </p>
        <h3>Playback</h3>
        <p>
          Hit <Kbd>Space</Kbd> or click <em>▶ Play</em> in the status bar. If a measure range
          is selected, only that range plays. Toggle the loop button (⟲) to repeat, the
          metronome (♩) for a click track, or the count-in (+1/+2) for one or two lead-in bars.
        </p>
        <h3>Selection</h3>
        <p>
          Click an empty area of a measure to select that measure. Shift-click another measure
          to extend the range. Cmd-click on multi-staff scores toggles which staves are part
          of the selection. Selections drive copy/paste, AI scope, and playback range.
        </p>
      </>
    ),
  },
  {
    id: "perform-mode",
    title: "Perform Mode",
    body: (
      <>
        <p>
          Perform mode is a stripped-down full-screen view for actually playing your song,
          designed for use on stage or at the music stand. It currently works for chord-chart
          songs (sections with lyrics + chords).
        </p>
        <h3>What&apos;s hidden</h3>
        <ul>
          <li>Menu bar, sidebar, status bar, properties — all gone.</li>
          <li>Editing controls — Perform mode is read-only.</li>
          <li>Annotation controls — annotations themselves can still be shown, but you
          can&apos;t add or edit them while performing.</li>
        </ul>
        <h3>What you get</h3>
        <ul>
          <li>Large, high-contrast lyrics with chord names floating above the syllable they
          land on.</li>
          <li>Single- or double-column page layout (toggle in the floating controls).</li>
          <li>Page-snap navigation — arrow keys / page-down step a full screen at a time.</li>
          <li>A song picker for jumping to other saved songs without leaving Perform mode.</li>
        </ul>
        <h3>Entering and exiting</h3>
        <p>
          Click the <em>Perform</em> button in the mode selector at the top of the menu bar.
          To exit, press <Kbd>Esc</Kbd> or click the close button in the corner.
        </p>
      </>
    ),
  },
  {
    id: "annotate-mode",
    title: "Annotate Mode",
    body: (
      <>
        <p>
          Annotate mode lets you stick virtual sticky-notes anywhere on the score — for
          rehearsal notes, fingerings, comments to a bandmate, or reminders to yourself.
        </p>
        <h3>Placing a sticky note</h3>
        <ol>
          <li>Switch to <em>Annotate</em> via the mode selector.</li>
          <li>Click anywhere on the score where you want the note to live.</li>
          <li>Type your text. The note stays anchored at that location and travels with
          the score.</li>
        </ol>
        <h3>Colors</h3>
        <p>
          Each note has a color — <span className="text-yellow-300">yellow</span> (default),
          {" "}<span className="text-blue-300">blue</span>,
          {" "}<span className="text-pink-300">pink</span>, or
          {" "}<span className="text-green-300">green</span>. Use them for your own
          coding scheme — e.g. yellow for general notes, pink for &quot;ask the band&quot;,
          green for &quot;done&quot;.
        </p>
        <h3>Shared vs Personal</h3>
        <p>
          Each note has a visibility:
        </p>
        <ul>
          <li><strong>Shared</strong> — saved with the song and visible to everyone who
          loads it from the cloud.</li>
          <li><strong>Personal</strong> — stays on your device only. Good for private
          performance reminders.</li>
        </ul>
        <h3>Labels</h3>
        <p>
          Tag a note with a label like <em>Guitar</em>, <em>Voice</em>, or <em>Drums</em>
          (the defaults — you can add your own). Labels turn into chips in the filter bar.
        </p>
        <h3>Filter bar</h3>
        <p>
          The filter bar above the status bar lets you toggle Shared/Personal visibility
          and hide individual labels. Click a label chip to mute that group; click again
          to bring it back. Useful for &quot;hide all the drum notes when I&apos;m
          practicing guitar&quot;.
        </p>
      </>
    ),
  },
  {
    id: "chord-chart-mode",
    title: "Chord Chart Mode",
    body: (
      <>
        <p>
          A chord chart is a song laid out as lyrics with chord names above. NotationApp
          treats it as a separate document type, with its own renderer and its own Perform
          mode.
        </p>
        <h3>Creating a chord chart</h3>
        <p>
          Use <em>File → New Chord Chart</em>, or click <em>New Chord Chart</em> from the
          empty-state buttons. You start with a single empty Verse 1 section.
        </p>
        <h3>Pasting from clipboard</h3>
        <p>
          Use <em>Edit → Paste Lyrics / Chords…</em> or paste directly into the chart area.
          The parser recognizes:
        </p>
        <ul>
          <li><strong>Section headers</strong> like <code>Verse 1:</code>, <code>CHORUS</code>,
          <code> Pre-Chorus</code>, <code>Bridge</code>, <code>Intro</code>, <code>Outro</code>.</li>
          <li><strong>Chord lines</strong> — lines made up only of chord-shaped tokens
          (<code>Cmaj7</code>, <code>F#m7b5</code>, <code>Bb/D</code>) get treated as
          chords above the next lyric line.</li>
          <li><strong>Inline chords</strong> — chords inside lyric lines, like
          <code>[C]Hello [G]world</code>, are detected and floated above the right syllable.</li>
        </ul>
        <h3>Editing</h3>
        <p>
          Click any chord or lyric to edit it inline. Right-click a section header for
          options like rename, duplicate, or delete.
        </p>
      </>
    ),
  },
  {
    id: "my-songs",
    title: "My Songs",
    body: (
      <>
        <p>
          The <em>My Songs</em> dialog (under the File menu, or <Kbd>Cmd&nbsp;K</Kbd> →
          &quot;My Songs&quot;) is your local song bank. It also syncs to the cloud if
          cloud autosave is configured for your build.
        </p>
        <h3>Saving</h3>
        <p>
          Songs you load from My Songs autosave continuously — you don&apos;t need to hit
          Save. For brand-new untitled scores, use <em>File → Save Revision</em> (<Kbd>Cmd&nbsp;S</Kbd>)
          to give it a name and add it to the bank.
        </p>
        <h3>Folders</h3>
        <p>
          Drag songs into folders for organization. Folder structure syncs across your
          devices when cloud is on.
        </p>
        <h3>Revisions</h3>
        <p>
          Each save creates a revision. The Revisions panel (in the sidebar) shows them
          chronologically, with named milestones (your manual saves) preserved indefinitely
          and unnamed autosaves rolled up over time.
        </p>
        <h3>Recover from autosave</h3>
        <p>
          If a session crashes, <em>File → Recover from Auto-save…</em> shows the last
          ~50 IndexedDB snapshots so you can restore one.
        </p>
      </>
    ),
  },
  {
    id: "ai-features",
    title: "AI Features",
    body: (
      <>
        <p>
          The AI Assistant lives in the sidebar. Open it with <Kbd>Cmd&nbsp;B</Kbd> and
          expand the <em>AI Assistant</em> drawer.
        </p>
        <h3>What it can do</h3>
        <ul>
          <li>Generate a score from a description: <em>&quot;a 16-bar blues in F with a
          walking bass line&quot;</em>.</li>
          <li>Edit the current score: <em>&quot;transpose to G major&quot;</em>,
          <em>&quot;add a harmony a third above the melody&quot;</em>,
          <em>&quot;double the tempo&quot;</em>.</li>
          <li>Operate on a selection — select measures first, and the AI scopes its
          edit to that range. The selection gets attached to the prompt automatically.</li>
          <li>Right-click any note → <em>Edit with AI</em> to open an inline prompt
          targeted at just that note.</li>
        </ul>
        <h3>Built-in commands</h3>
        <p>
          Some prompts are recognized as deterministic transforms and run instantly without
          calling the AI — things like <em>copy</em>, <em>paste</em>, <em>transpose up
          a step</em>. The AI is only invoked when needed.
        </p>
        <h3>Bring Your Own Key (BYOK)</h3>
        <p>
          If your build supports BYOK, you can supply your own Anthropic API key in
          settings — usage is then billed to your account directly. If BYOK isn&apos;t
          enabled in your deployment, the AI features use the server&apos;s configured
          key (or fall back to a static-export message if neither is available).
        </p>
      </>
    ),
  },
  {
    id: "shortcuts",
    title: "Keyboard Shortcuts",
    body: (
      <>
        <p>
          Most actions also have menu-bar entries with the shortcut shown. Cmd is shown
          for macOS — substitute Ctrl on Windows/Linux.
        </p>
        <ShortcutTable
          rows={[
            ["Play / Stop", "Space"],
            ["Undo", "Cmd Z"],
            ["Redo", "Cmd Shift Z"],
            ["Copy selection", "Cmd C"],
            ["Paste", "Cmd V"],
            ["Select all measures", "Cmd A"],
            ["Clear selection", "Esc"],
            ["Toggle sidebar", "Cmd B"],
            ["Command palette", "Cmd K"],
            ["Save revision", "Cmd S"],
            ["Print", "Cmd P"],
            ["Zoom in / out / reset", "Cmd = / Cmd - / Cmd 0"],
            ["Zoom (also)", "Cmd + scroll wheel, trackpad pinch"],
            ["Cursor right (whole beat)", "→"],
            ["Cursor right (half beat)", "Shift →"],
            ["Cursor left (whole beat)", "←"],
            ["Cursor left (half beat)", "Shift ←"],
            ["Cursor between staves", "↑ / ↓"],
            ["Toggle lyric mode", "L"],
            ["Delete selected note", "Delete"],
            ["Exit Perform mode", "Esc"],
          ]}
        />
      </>
    ),
  },
  {
    id: "faq",
    title: "FAQ",
    body: (
      <>
        <h3>My MIDI keyboard isn&apos;t showing up</h3>
        <p>
          Web MIDI requires Chrome, Edge, or another Chromium-based browser, served over
          HTTPS (or localhost). Safari and Firefox don&apos;t fully support it. If your
          device is plugged in but not detected, refresh the page and re-allow MIDI access
          when prompted.
        </p>
        <h3>Why does playback sound thin / synth-y?</h3>
        <p>
          NotationApp uses a built-in WebAudio synth — there&apos;s no SoundFont loader
          yet. The point is hearing what you wrote, not production audio. Export to MIDI
          and load it in your DAW for real sounds.
        </p>
        <h3>I lost work — where did it go?</h3>
        <p>
          Try <em>File → Recover from Auto-save…</em>. NotationApp keeps roughly the last
          50 IndexedDB snapshots, taken every 5 seconds while you edit. If your song was
          in the song bank, it also lives there with its own revision history.
        </p>
        <h3>Can I import a PDF or scan?</h3>
        <p>
          Not directly. <em>Tools → Transcribe Audio…</em> can convert an audio recording
          (mp3, m4a, wav, etc.) into a starting score that you then clean up.
          <em>File → Import…</em> handles MIDI, MusicXML (.mxl/.xml), and JSON projects.
        </p>
        <h3>How do I share a song with someone?</h3>
        <p>
          From My Songs, share the URL with <code>?join=&lt;your-device-id&gt;</code>.
          The recipient is prompted to take over your songbook. (This works only on builds
          where cloud is enabled.) For one-off sharing, export to MusicXML or JSON and
          send the file.
        </p>
        <h3>Where do annotations live?</h3>
        <p>
          Shared annotations are saved inside the score JSON itself — they travel with
          the song. Personal annotations stay on the device that created them and never
          sync.
        </p>
      </>
    ),
  },
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-block px-1.5 py-0.5 mx-0.5 text-[11px] font-mono rounded border border-white/20 bg-white/10 text-gray-100">
      {children}
    </kbd>
  );
}

function ShortcutTable({ rows }: { rows: [string, string][] }) {
  return (
    <table className="w-full text-sm border-collapse mt-3">
      <thead>
        <tr className="text-left text-gray-400 border-b border-white/10">
          <th className="py-2 pr-4 font-medium">Action</th>
          <th className="py-2 font-medium">Shortcut</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([action, keys]) => (
          <tr key={action} className="border-b border-white/5">
            <td className="py-1.5 pr-4 text-gray-200">{action}</td>
            <td className="py-1.5 text-gray-300 font-mono text-[12px]">{keys}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function DocsPage() {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string>(SECTIONS[0].id);
  const [navOpen, setNavOpen] = useState(false);

  const filteredSections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.filter((s) => s.title.toLowerCase().includes(q));
  }, [query]);

  // Scroll-spy: update the active sidebar link based on whichever section's
  // heading is closest to the top of the scroll area.
  useEffect(() => {
    const handler = () => {
      let current = SECTIONS[0].id;
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top - 120 <= 0) current = s.id;
      }
      setActiveId(current);
    };
    handler();
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  const handleNavClick = useCallback((id: string) => {
    setNavOpen(false);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <div className="min-h-screen bg-[#0f0f23] text-gray-200">
      {/* Top bar */}
      <header className="sticky top-0 z-40 bg-[#0f0f23]/95 backdrop-blur border-b border-white/10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link
            href="/"
            className="text-sm font-bold tracking-wide text-gray-100 hover:text-white"
          >
            ♩ NotationApp
          </Link>
          <span className="text-gray-600">/</span>
          <span className="text-sm text-gray-300">Docs</span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setNavOpen((v) => !v)}
            className="md:hidden px-2.5 py-1 text-xs rounded border border-white/15 text-gray-300 hover:bg-white/10"
            aria-label="Toggle navigation"
          >
            {navOpen ? "Close" : "Menu"}
          </button>
          <Link
            href="/"
            className="hidden md:inline-block px-3 py-1 text-xs rounded border border-white/15 text-gray-300 hover:bg-white/10"
          >
            Open the app →
          </Link>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 md:py-10 flex flex-col md:flex-row gap-8">
        {/* Sidebar nav */}
        <aside
          className={`${
            navOpen ? "block" : "hidden"
          } md:block md:sticky md:top-20 md:self-start md:w-60 md:shrink-0 md:max-h-[calc(100vh-6rem)] md:overflow-y-auto`}
        >
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sections…"
            className="w-full mb-3 px-3 py-2 text-sm rounded-md bg-white/5 border border-white/10 text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-blue-400"
          />
          <nav className="flex flex-col gap-0.5 text-sm">
            {filteredSections.length === 0 ? (
              <span className="text-xs text-gray-500 px-2 py-1">No matches.</span>
            ) : (
              filteredSections.map((s) => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    handleNavClick(s.id);
                  }}
                  className={`px-3 py-1.5 rounded transition-colors ${
                    activeId === s.id
                      ? "bg-blue-600/20 text-blue-200 border-l-2 border-blue-400"
                      : "text-gray-400 hover:bg-white/5 hover:text-gray-200 border-l-2 border-transparent"
                  }`}
                >
                  {s.title}
                </a>
              ))
            )}
          </nav>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0">
          <h1 className="text-3xl md:text-4xl font-bold text-gray-50 mb-2">
            NotationApp Documentation
          </h1>
          <p className="text-gray-400 mb-10">
            Everything the app can do, in one place. Use the sidebar to jump around, or
            search by section title.
          </p>

          <div className="docs-prose space-y-12">
            {SECTIONS.map((s) => (
              <section key={s.id} id={s.id} className="scroll-mt-24">
                <h2 className="text-2xl font-semibold text-gray-100 mb-4 pb-2 border-b border-white/10">
                  {s.title}
                </h2>
                <div className="space-y-3 text-[15px] leading-relaxed text-gray-300">
                  {s.body}
                </div>
              </section>
            ))}
          </div>

          <footer className="mt-16 pt-6 border-t border-white/10 text-xs text-gray-500">
            Missing something? Open an issue on the project repo, or ask the AI Assistant
            for a workaround.
          </footer>
        </main>
      </div>

      {/* Local prose styles — keeps the section bodies readable without
          pulling in @tailwindcss/typography. Plain <style> avoids the
          styled-jsx SSR registry dance in Next 16. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            .docs-prose h3 {
              font-size: 1rem;
              font-weight: 600;
              color: #e5e7eb;
              margin-top: 1.25rem;
              margin-bottom: 0.5rem;
            }
            .docs-prose ul,
            .docs-prose ol {
              padding-left: 1.25rem;
              list-style: disc;
            }
            .docs-prose ol { list-style: decimal; }
            .docs-prose li { margin: 0.25rem 0; }
            .docs-prose code {
              padding: 0.05rem 0.35rem;
              background: rgba(255, 255, 255, 0.08);
              border-radius: 4px;
              font-size: 0.85em;
              color: #f3f4f6;
            }
            .docs-prose strong { color: #f3f4f6; }
          `,
        }}
      />
    </div>
  );
}
