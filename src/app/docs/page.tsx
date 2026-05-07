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
          Musicians ask notation software for two different things. Sometimes you&apos;re
          arranging a full piece and need precise notation — the staves, the rhythms, the
          dynamics. Other times you&apos;re at a band rehearsal and just need the chords
          and lyrics on one page. NotationApp supports both, and is designed so a future
          release can blend the two in a single document.
        </p>
        <h3>Document types — what you&apos;re working with</h3>
        <ul>
          <li>
            <strong>Score</strong> — full music notation: staves, notes, rhythms,
            dynamics, articulations. The right pick for arranging, composition, or anything
            that needs the precise pitches and durations on the page.
          </li>
          <li>
            <strong>Chord Chart</strong> — chords above lyrics, broken into sections
            (Verse, Chorus, Bridge, …). The right pick for songbooks, lead sheets, and
            band rehearsals where the singer just needs the words and the band just needs
            the changes.
          </li>
          <li>
            <strong>Blended document</strong> <em>(coming soon)</em> — a single document
            that mixes notated passages with chord-chart sections, so a song can carry its
            head arrangement and its rhythm-section chart side by side.
          </li>
        </ul>
        <h3>View modes — how you&apos;re looking at it</h3>
        <p>
          Whatever document type you&apos;re working with, you need two ways of looking
          at it:
        </p>
        <ul>
          <li>
            <strong>Edit</strong> — the full interface. Menu bar, sidebar, properties,
            note-entry tools, AI panel. This is where you build the document.
          </li>
          <li>
            <strong>Perform</strong> — clean, distraction-free, full-screen. The chrome
            disappears so you can read off the page while playing or rehearsing.
          </li>
        </ul>
        <p>
          Edit and Perform both work for Scores and for Chord Charts. The mode selector at
          the top of the menu bar flips between them.
        </p>
        <h3>Annotations — cutting across both views</h3>
        <p>
          A sticky note isn&apos;t something you stop everything to add. If your teacher
          says &quot;watch the dynamics here&quot; in the middle of a run-through, you
          shouldn&apos;t have to leave Perform mode to write it down. So Annotate is a
          function available <em>inside</em> both Edit and Perform — turn it on, tap the
          spot, type the note, keep going.
        </p>
        <h3>Where the AI fits</h3>
        <p>
          For most edits, manual is faster: click a beat, type a note; click a chord,
          retype it. The AI Assistant is for the moments where typing your intent beats
          clicking through menus — operations that span measures or sections, like
          <em> &quot;transpose the bridge up a whole step&quot;</em>,
          <em> &quot;copy the chord pattern from verse 1 to verse 2&quot;</em>, or
          <em> &quot;add a pickup measure before the chorus&quot;</em>. Reach for the AI
          panel when the change is large enough that describing it is faster than doing it
          by hand.
        </p>
        <h3>First steps</h3>
        <ol>
          <li>From the empty state, click <em>New Score</em> for staff notation, or
          <em> New Chord Chart</em> for a lyrics-and-chords song.</li>
          <li>Open the sidebar with <Kbd>Cmd&nbsp;B</Kbd> to reveal the AI Assistant and
          Properties drawers.</li>
          <li>Build the document in <em>Edit</em>; flip to <em>Perform</em> when you&apos;re
          ready to play it.</li>
          <li>Use <em>File → My Songs</em> to save your work to the local song bank (and
          the cloud, if your build has it configured).</li>
        </ol>
      </>
    ),
  },
  {
    id: "scores",
    title: "Scores",
    body: (
      <>
        <p>
          A Score is a full music-notation document — staves, time and key signatures,
          notes with explicit pitches and durations, dynamics, and articulations. Use it
          when the precise musical content matters: arrangements, compositions, vocal
          parts, lead sheets where someone needs to read the actual melody.
        </p>
        <h3>Creating a score</h3>
        <p>
          From the empty state, click <em>New Score</em>, or <em>File → New Score</em>.
          You start with one staff in C major, 4/4, 16 measures — change any of those in
          the Properties drawer.
        </p>
        <h3>What&apos;s in a Score</h3>
        <ul>
          <li>One or more <strong>staves</strong>, each with its own clef and (optionally)
          its own lyrics.</li>
          <li><strong>Notes and rests</strong> with explicit pitches, durations, and
          articulations.</li>
          <li><strong>Time signature, key signature, tempo, anacrusis</strong> — all
          editable in Properties.</li>
          <li><strong>Repeats and rehearsal marks</strong> for navigation.</li>
          <li><strong>Chord symbols above the staff</strong> when you want both the
          notated melody and the changes.</li>
        </ul>
        <p>
          Building and editing a Score is covered under <em>Edit Mode</em> below. Reading
          one back during practice is covered under <em>Perform Mode</em>.
        </p>
      </>
    ),
  },
  {
    id: "chord-charts",
    title: "Chord Charts",
    body: (
      <>
        <p>
          A Chord Chart is a song laid out as lyrics with chord names above, broken into
          sections (Verse, Chorus, Bridge, …). It&apos;s the right document type for
          band rehearsals, songbooks, and any context where the singer just needs the
          words and the players just need the changes.
        </p>
        <h3>Creating a chord chart</h3>
        <p>
          Use <em>File → New Chord Chart</em>, or click <em>New Chord Chart</em> from
          the empty-state buttons. You start with a single empty Verse 1 section and add
          more from there.
        </p>
        <h3>Pasting from clipboard</h3>
        <p>
          Use <em>Edit → Paste Lyrics / Chords…</em> or paste directly into the chart
          area. The parser recognizes:
        </p>
        <ul>
          <li><strong>Section headers</strong> like <code>Verse 1:</code>,
          <code> CHORUS</code>, <code>Pre-Chorus</code>, <code>Bridge</code>,
          <code> Intro</code>, <code>Outro</code>.</li>
          <li><strong>Chord lines</strong> — lines made up only of chord-shaped tokens
          (<code>Cmaj7</code>, <code>F#m7b5</code>, <code>Bb/D</code>) get treated as
          chords above the next lyric line.</li>
          <li><strong>Inline chords</strong> — chords inside lyric lines, like
          <code>[C]Hello [G]world</code>, are detected and floated above the right
          syllable.</li>
        </ul>
        <h3>Editing</h3>
        <p>
          Click any chord or lyric to edit it inline. Right-click a section header for
          options like rename, duplicate, or delete. Section labels are reorderable —
          dragging a section moves all its lines with it.
        </p>
      </>
    ),
  },
  {
    id: "blended-documents",
    title: "Blended Documents (coming soon)",
    body: (
      <>
        <p>
          A <strong>blended document</strong> lets you mix document types <em>within a
          single piece</em>. The frame is a Chord Chart — verses, choruses, the usual
          sections — but any individual section can switch to a different format when the
          music calls for it. Concretely, blended sections can be:
        </p>
        <ul>
          <li>
            <strong>Passages</strong> — a notated melody or arrangement excerpt. Use them
            for things like a fully written-out intro, a vocal melody on the bridge, or a
            horn line that the players need on the page.
          </li>
          <li>
            <strong>Licks</strong> — short notated phrases, riffs, or fills that are far
            easier to read in notation than to describe in words. Drop one between chord
            sections to specify a turnaround, a signature lick, or a fill.
          </li>
          <li>
            <strong>Tab</strong> — guitar or bass tablature, for sections, licks, or solos
            where fret positions matter (a specific voicing on the neck, a fingerstyle
            pattern, a solo).
          </li>
        </ul>
        <p>
          The use case is the realistic one: most of a song is a chord chart (verse,
          chorus), but the guitar solo is tab, and the horn intro is notated. Today
          that&apos;s three separate documents. With blended mode, it&apos;s one.
        </p>
        <p>
          This is on the roadmap. Today you can build either a Score or a Chord Chart,
          but not interleave them. When the feature lands, individual sections inside a
          Chord Chart will get a section-type selector (<em>Chord Chart</em>, <em>Notation
          passage</em>, <em>Tab</em>, <em>Lick</em>) and Edit/Perform will render each
          section in its appropriate format inline.
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
          Edit is the full interface — menu bar, sidebar, properties, status bar — and
          it&apos;s where you build the document. It works the same way for Scores and
          Chord Charts: the controls that don&apos;t apply to the current document type
          simply disappear (no staff-tools when you&apos;re editing a Chord Chart, no
          section-tools when you&apos;re editing a Score).
        </p>
        <h3>Entering notes (Score)</h3>
        <ul>
          <li>Click an empty beat to place the cursor.</li>
          <li>Type <Kbd>A</Kbd>–<Kbd>G</Kbd> to add a note at the cursor; the cursor
          advances to the next beat.</li>
          <li>Use the on-screen MIDI keyboard at the bottom of the screen, or play a
          connected MIDI device.</li>
          <li>Press <Kbd>L</Kbd> to enter lyric mode — type words under the highlighted
          note, space advances to the next note.</li>
          <li>Right-click a note for the context menu (change duration, edit with AI,
          delete).</li>
        </ul>
        <h3>Entering chords and lyrics (Chord Chart)</h3>
        <ul>
          <li>Click a chord or lyric line to edit it inline.</li>
          <li>Add or rename sections from the section header right-click menu, or paste
          a whole song via <em>Edit → Paste Lyrics / Chords…</em>.</li>
        </ul>
        <h3>Document properties</h3>
        <p>
          Open the <em>Properties</em> drawer in the sidebar to change key, time
          signature, tempo, number of measures, anacrusis (pickup bar), and more. Changes
          apply immediately and are undoable.
        </p>
        <h3>Playback</h3>
        <p>
          Hit <Kbd>Space</Kbd> or click <em>▶ Play</em> in the status bar. If a measure
          range is selected, only that range plays. Toggle the loop button (⟲) to repeat,
          the metronome (♩) for a click track, or the count-in (+1/+2) for one or two
          lead-in bars.
        </p>
        <h3>Selection</h3>
        <p>
          Click an empty area of a measure to select that measure. Shift-click another
          measure to extend the range. Cmd-click on multi-staff scores toggles which
          staves are part of the selection. Selections drive copy/paste, AI scope, and
          playback range.
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
          Perform is a stripped-down full-screen view for actually playing your document,
          designed for the music stand or the stage. It works for both Scores and Chord
          Charts; the chord-chart Perform view is the most polished today, with large
          high-contrast lyrics and page-snap navigation.
        </p>
        <h3>What&apos;s hidden</h3>
        <ul>
          <li>Menu bar, sidebar, status bar, properties — all gone.</li>
          <li>Editing controls — Perform is read-only as far as note entry goes.</li>
        </ul>
        <h3>What you get (Chord Chart Perform)</h3>
        <ul>
          <li>Large, high-contrast lyrics with chord names floating above the syllable
          they land on.</li>
          <li>Single- or double-column page layout (toggle in the floating controls).</li>
          <li>Page-snap navigation — arrow keys / page-down step a full screen at a
          time.</li>
          <li>A song picker for jumping to other saved songs without leaving Perform.</li>
        </ul>
        <h3>Annotating from Perform</h3>
        <p>
          Annotate is available right inside Perform — there&apos;s a small button in
          the floating control cluster. Tap it, drop a sticky note where you&apos;re
          looking, and you stay on the same page at the same scroll position. See
          <em> Annotations</em> below.
        </p>
        <h3>Entering and exiting</h3>
        <p>
          Click the <em>Perform</em> button in the mode selector at the top of the menu
          bar. To exit, press <Kbd>Esc</Kbd> or click the close button in the corner.
        </p>
      </>
    ),
  },
  {
    id: "annotations",
    title: "Annotations",
    body: (
      <>
        <p>
          Annotations are virtual sticky notes you place anywhere on the document — for
          rehearsal notes, fingerings, comments to a bandmate, or reminders to yourself.
          Annotation is a <em>function</em>, not a top-level mode: you can use it from
          inside Edit <em>or</em> from inside Perform, without leaving the view
          you&apos;re in.
        </p>
        <h3>Turning Annotate on</h3>
        <ul>
          <li>From <em>Edit</em>: pick <strong>Annotate</strong> in the mode selector at
          the top of the menu bar. The editing chrome stays in place; the cursor turns
          into a note-drop tool.</li>
          <li>From <em>Perform</em>: tap the small <strong>Annotate</strong> button in
          the floating control cluster. The full-screen view stays, the page stays
          where it was — only the cursor changes.</li>
        </ul>
        <h3>Placing a sticky note</h3>
        <ol>
          <li>With Annotate active, click anywhere on the document where you want the
          note to live.</li>
          <li>Type your text. The note stays anchored at that location and travels with
          the document.</li>
        </ol>
        <h3>Colors</h3>
        <p>
          Each note has a color — <span className="text-yellow-300">yellow</span>{" "}
          (default), <span className="text-blue-300">blue</span>,
          {" "}<span className="text-pink-300">pink</span>, or
          {" "}<span className="text-green-300">green</span>. Use them for your own coding
          scheme — e.g. yellow for general notes, pink for &quot;ask the band&quot;, green
          for &quot;done&quot;.
        </p>
        <h3>Shared vs Personal</h3>
        <p>Each note has a visibility:</p>
        <ul>
          <li><strong>Shared</strong> — saved with the song and visible to everyone who
          loads it from the cloud.</li>
          <li><strong>Personal</strong> — stays on your device only. Good for private
          performance reminders.</li>
        </ul>
        <h3>Labels</h3>
        <p>
          Tag a note with a label like <em>Guitar</em>, <em>Voice</em>, or <em>Drums</em>
          {" "}(the defaults — you can add your own). Labels turn into chips in the filter
          bar.
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
    id: "ai-assistant",
    title: "AI Assistant",
    body: (
      <>
        <p>
          The AI Assistant lives in the sidebar — open it with <Kbd>Cmd&nbsp;B</Kbd> and
          expand the <em>AI Assistant</em> drawer. The right time to reach for it is when
          typing your intent is faster than doing it by hand.
        </p>
        <h3>When manual editing is faster</h3>
        <p>
          Single notes, single chords, fixing a typo in a lyric, changing a duration —
          click and type. The UI is built for that, and it&apos;ll always be quicker
          than describing the change in words.
        </p>
        <h3>When the AI is faster</h3>
        <p>
          Anything that spans measures, sections, or staves. Examples:
        </p>
        <ul>
          <li><em>&quot;Transpose the bridge up a whole step&quot;</em></li>
          <li><em>&quot;Copy the chord pattern from verse 1 to verse 2&quot;</em></li>
          <li><em>&quot;Add a pickup measure before the chorus&quot;</em></li>
          <li><em>&quot;Add a harmony a third above the melody from measures 9–16&quot;</em></li>
          <li><em>&quot;Generate a 16-bar blues in F with a walking bass line&quot;</em>{" "}
          (creates a new score from scratch).</li>
        </ul>
        <h3>Scoping with selection</h3>
        <p>
          Select a measure range first — the AI scopes its edit to that range and the
          selection is attached to the prompt automatically. For inline single-note
          edits, right-click a note → <em>Edit with AI</em>.
        </p>
        <h3>Built-in commands</h3>
        <p>
          Some prompts are recognized as deterministic transforms and run instantly
          without calling the AI — things like <em>copy</em>, <em>paste</em>,
          <em> transpose up a step</em>. The AI is only invoked when needed.
        </p>
        <h3>Bring Your Own Key (BYOK)</h3>
        <p>
          You can supply your own Anthropic or OpenAI API key from
          <em> Edit → API Keys</em>; usage is then billed to your account directly. If
          no BYOK key is set and the deployment doesn&apos;t have a server-side default
          configured, the AI panel shows a &quot;No LLM connected&quot; banner with a
          shortcut to add one.
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
