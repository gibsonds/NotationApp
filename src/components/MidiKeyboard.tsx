"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { MidiKeyboardInput, midiNumberToPitch } from "@/lib/midi-input";
import { useScoreStore, StepEntryState } from "@/store/score-store";
import { Note, NoteDuration } from "@/lib/schema";
import { noteOn as audioNoteOn, noteOff as audioNoteOff, allNotesOff } from "@/lib/midi-audio";
import { debugLog } from "@/lib/debug-log";
import { v4 as uuidv4 } from "uuid";

// Duration key map: number key → duration + beat value
const DURATION_MAP: Record<string, { dur: NoteDuration; beats: number }> = {
  "1": { dur: "whole", beats: 4 },
  "2": { dur: "half", beats: 2 },
  "3": { dur: "quarter", beats: 1 },
  "4": { dur: "eighth", beats: 0.5 },
  "5": { dur: "sixteenth", beats: 0.25 },
  "6": { dur: "thirty-second", beats: 0.125 },
  "7": { dur: "sixty-fourth", beats: 0.0625 },
};

const DUR_LABELS: Record<string, string> = {
  "1": "𝅝", "2": "𝅗𝅥", "3": "♩", "4": "♪", "5": "𝅘𝅥𝅯", "6": "𝅘𝅥𝅰", "7": "𝅘𝅥𝅱",
};

// Letter-key pitch entry: A-G enter notes at sensible octaves relative to clef
const PITCH_LETTERS = ["C", "D", "E", "F", "G", "A", "B"];

/** Resolve a pitch letter to octave nearest to lastPitch, defaulting by clef */
function resolvePitch(letter: string, lastPitch: string | null, clef: string): string {
  const defaultOctave = clef === "bass" ? 3 : clef === "alto" ? 4 : 4;
  if (!lastPitch || lastPitch === "rest") return `${letter}${defaultOctave}`;

  const match = lastPitch.match(/^([A-G][b#]?)(\d+)$/);
  if (!match) return `${letter}${defaultOctave}`;

  const lastLetter = match[1].charAt(0);
  const lastOctave = parseInt(match[2]);

  // Pick the octave that produces the smallest interval
  const lastIdx = PITCH_LETTERS.indexOf(lastLetter);
  const newIdx = PITCH_LETTERS.indexOf(letter);
  const diff = newIdx - lastIdx;

  // If diff is small (within a 4th), same octave
  // If new note is much lower in the scale, go up an octave
  // If new note is much higher, go down an octave
  let octave = lastOctave;
  if (diff > 3) octave--;  // e.g., last=F, new=C → C would be far up, so go down
  if (diff < -3) octave++; // e.g., last=C, new=G → G would be far down, so go up

  // Clamp
  if (octave < 1) octave = 1;
  if (octave > 8) octave = 8;

  return `${letter}${octave}`;
}

interface TupletMode {
  actualNotes: number;
  normalNotes: number;
  remaining: number; // notes left to enter in this tuplet
}

// Tracks the last placed note so we can attach a lyric to it
interface LastPlacedNote {
  measure: number;
  beat: number;
  pitch: string;
}

export default function MidiKeyboard() {
  const {
    score, applyPatches, addMessage, stepEntry, setStepEntry, advanceStepCursor, stepBack,
  } = useScoreStore();

  const [connected, setConnected] = useState(false);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [activeKeys, setActiveKeys] = useState<Set<number>>(new Set());
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [tupletMode, setTupletMode] = useState<TupletMode | null>(null);
  const [tupletPending, setTupletPending] = useState(false);
  const [lastEnteredBeats, setLastEnteredBeats] = useState(0);
  const [lyricMode, setLyricMode] = useState(false);
  const [lyricPending, setLyricPending] = useState<LastPlacedNote | null>(null);
  const [lyricText, setLyricText] = useState("");
  const lyricInputRef = useRef<HTMLInputElement>(null);
  // Duration-first entry state
  const [currentDuration, setCurrentDuration] = useState<string>("3"); // default quarter
  const [lastPitch, setLastPitch] = useState<string | null>(null);

  const midiRef = useRef<MidiKeyboardInput | null>(null);
  const activeKeysRef = useRef<Set<number>>(new Set());
  const stepEntryRef = useRef<StepEntryState | null>(null);
  stepEntryRef.current = stepEntry;

  const connectMidi = useCallback(async () => {
    if (midiRef.current) {
      midiRef.current.disconnect();
    }

    const midi = new MidiKeyboardInput({
      onNoteOn: (pitch, velocity, midiNumber) => {
        debugLog(`[MidiKB onNoteOn] ${pitch} midi=${midiNumber} vel=${velocity} activeKeys before=${activeKeysRef.current.size}`);
        activeKeysRef.current.add(midiNumber);
        setActiveKeys(new Set(activeKeysRef.current));
        audioNoteOn(midiNumber, velocity);
      },
      onNoteOff: (pitch, midiNumber) => {
        debugLog(`[MidiKB onNoteOff] ${pitch} midi=${midiNumber} activeKeys before=${activeKeysRef.current.size}`);
        activeKeysRef.current.delete(midiNumber);
        setActiveKeys(new Set(activeKeysRef.current));
        audioNoteOff(midiNumber);
      },
      onDeviceConnected: (name) => {
        setDeviceName(name);
        setConnected(true);
      },
      onDeviceDisconnected: () => {
        setDeviceName(null);
        setConnected(false);
      },
      onError: (error) => {
        addMessage({
          id: uuidv4(),
          role: "assistant",
          content: `MIDI error: ${error}`,
          timestamp: Date.now(),
        });
      },
    });

    const devices = await midi.connect();
    midiRef.current = midi;

    if (devices.length > 0) {
      setDeviceName(devices[0]);
      setConnected(true);
      addMessage({
        id: uuidv4(),
        role: "assistant",
        content: `MIDI connected: ${devices.join(", ")}`,
        timestamp: Date.now(),
      });
    } else {
      addMessage({
        id: uuidv4(),
        role: "assistant",
        content: "No MIDI devices found. Connect a keyboard and try again.",
        timestamp: Date.now(),
      });
    }
  }, [addMessage]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      midiRef.current?.disconnect();
      allNotesOff();
    };
  }, []);

  // Auto-activate step entry when a score first appears (new or loaded)
  const activatedForRef = useRef<string | null>(null);
  useEffect(() => {
    const id = score?.id ?? null;
    if (!id) { activatedForRef.current = null; return; }
    // Only activate once per score ID
    if (activatedForRef.current === id) return;
    activatedForRef.current = id;
    const staff = score!.staves[0];
    const voice = staff?.voices[0];
    if (staff && voice) {
      debugLog(`[AutoStep] Activating step entry for score ${id}, M1 B1`);
      setStepEntry({
        active: true,
        staffId: staff.id,
        voiceId: voice.id,
        measure: 1,
        beat: 1,
      });
    }
  }, [score?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleStepEntry = () => {
    if (stepEntry) {
      setStepEntry(null);
      setTupletMode(null);
      setTupletPending(false);
      setLyricMode(false);
      setLyricPending(null);
    } else if (score) {
      const staff = score.staves[0];
      const voice = staff?.voices[0];
      if (staff && voice) {
        setStepEntry({
          active: true,
          staffId: staff.id,
          voiceId: voice.id,
          measure: 1,
          beat: 1,
        });
      }
    }
  };

  // Place a note or rest at the current cursor
  const placeNote = useCallback((
    pitchOrRest: string,
    duration: NoteDuration,
    beats: number,
    tuplet?: { actualNotes: number; normalNotes: number },
  ) => {
    if (!score || !stepEntry) return;

    debugLog(`[Place] ${pitchOrRest} ${duration} (${beats} beats) at M${stepEntry.measure} B${stepEntry.beat}, activeKeys=${activeKeysRef.current.size}`);

    const note: Note = {
      pitch: pitchOrRest,
      duration,
      dots: 0,
      accidental: "none",
      tieStart: false,
      tieEnd: false,
      measure: stepEntry.measure,
      beat: stepEntry.beat,
      ...(tuplet ? { tuplet } : {}),
    };

    applyPatches([{
      op: "add_notes",
      staffId: stepEntry.staffId,
      voiceId: stepEntry.voiceId,
      notes: [note],
    }]);

    const actualBeats = tuplet
      ? beats * (tuplet.normalNotes / tuplet.actualNotes)
      : beats;
    setLastEnteredBeats(actualBeats);
    advanceStepCursor(actualBeats);

    // If lyric mode is on and this is a pitched note, prompt for lyric
    if (lyricMode && pitchOrRest !== "rest") {
      setLyricPending({ measure: stepEntry.measure, beat: stepEntry.beat, pitch: pitchOrRest });
      setLyricText("");
      // Focus the lyric input after render
      setTimeout(() => lyricInputRef.current?.focus(), 0);
    }
  }, [score, stepEntry, applyPatches, advanceStepCursor, lyricMode]);

  // Add dot to last entered note
  const addDotToLast = useCallback(() => {
    if (!score || !stepEntry) return;
    // Find the note just before cursor
    const staff = score.staves.find(s => s.id === stepEntry.staffId);
    const voice = staff?.voices.find(v => v.id === stepEntry.voiceId);
    if (!voice) return;

    // Get the last note we placed (the one right before cursor position)
    const notes = voice.notes
      .filter(n => n.measure === stepEntry.measure || n.measure === stepEntry.measure - 1)
      .sort((a, b) => a.measure - b.measure || a.beat - b.beat);

    const lastNote = notes[notes.length - 1];
    if (!lastNote || lastNote.dots >= 2) return;

    // Remove old note and add dotted version
    const updatedNote = { ...lastNote, dots: lastNote.dots + 1 };
    applyPatches([
      {
        op: "remove_note",
        staffId: stepEntry.staffId,
        voiceId: stepEntry.voiceId,
        measure: lastNote.measure,
        beat: lastNote.beat,
        pitch: lastNote.pitch,
      },
      {
        op: "add_notes",
        staffId: stepEntry.staffId,
        voiceId: stepEntry.voiceId,
        notes: [updatedNote],
      },
    ]);

    // Advance cursor by half the last duration
    const extraBeats = lastEnteredBeats * 0.5;
    advanceStepCursor(extraBeats);
  }, [score, stepEntry, applyPatches, advanceStepCursor, lastEnteredBeats]);

  // Commit lyric to the pending note
  const commitLyric = useCallback(() => {
    if (!lyricPending || !stepEntry || !score) return;
    const staff = score.staves.find(s => s.id === stepEntry.staffId);
    const voice = staff?.voices.find(v => v.id === stepEntry.voiceId);
    if (!voice) return;

    // Find the note we just placed
    const target = voice.notes.find(n =>
      n.measure === lyricPending.measure &&
      Math.abs(n.beat - lyricPending.beat) < 0.001 &&
      n.pitch === lyricPending.pitch
    );
    if (!target) { setLyricPending(null); return; }

    if (lyricText.trim()) {
      const updated = { ...target, lyric: lyricText.trim() };
      applyPatches([
        { op: "remove_note", staffId: stepEntry.staffId, voiceId: stepEntry.voiceId, measure: target.measure, beat: target.beat, pitch: target.pitch },
        { op: "add_notes", staffId: stepEntry.staffId, voiceId: stepEntry.voiceId, notes: [updated] },
      ]);
    }
    setLyricPending(null);
    setLyricText("");
  }, [lyricPending, lyricText, stepEntry, score, applyPatches]);

  // Skip lyric (empty) for this note
  const skipLyric = useCallback(() => {
    setLyricPending(null);
    setLyricText("");
  }, []);

  // Delete last note and move cursor back
  const deleteLastNote = useCallback(() => {
    if (!score || !stepEntry) return;
    const staff = score.staves.find(s => s.id === stepEntry.staffId);
    const voice = staff?.voices.find(v => v.id === stepEntry.voiceId);
    if (!voice || voice.notes.length === 0) return;

    // Find the last note by position
    const sorted = [...voice.notes].sort(
      (a, b) => a.measure - b.measure || a.beat - b.beat
    );
    const lastNote = sorted[sorted.length - 1];
    if (!lastNote) return;

    // Calculate beats to step back
    const DUR_BEATS: Record<string, number> = {
      whole: 4, half: 2, quarter: 1, eighth: 0.5, sixteenth: 0.25,
      "thirty-second": 0.125, "sixty-fourth": 0.0625,
    };
    let noteBeats = DUR_BEATS[lastNote.duration] || 1;
    if (lastNote.dots) noteBeats *= 1.5;
    if (lastNote.tuplet) noteBeats *= lastNote.tuplet.normalNotes / lastNote.tuplet.actualNotes;

    applyPatches([{
      op: "remove_note",
      staffId: stepEntry.staffId,
      voiceId: stepEntry.voiceId,
      measure: lastNote.measure,
      beat: lastNote.beat,
      pitch: lastNote.pitch,
    }]);

    stepBack(noteBeats);
  }, [score, stepEntry, applyPatches, stepBack]);

  // Keyboard handler for step-entry
  useEffect(() => {
    if (!stepEntry) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture if user is typing in an input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      // Space held = rest mode
      if (e.code === "Space") {
        e.preventDefault();
        setSpaceHeld(true);
        return;
      }

      // Escape = exit step-entry
      if (e.key === "Escape") {
        setStepEntry(null);
        setTupletMode(null);
        setTupletPending(false);
        setLyricMode(false);
        setLyricPending(null);
        return;
      }

      // Backspace or Delete = delete last note
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        deleteLastNote();
        return;
      }

      // Dot = add dot to last note
      if (e.key === ".") {
        e.preventDefault();
        addDotToLast();
        return;
      }

      // T = start tuplet mode
      if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        setTupletPending(true);
        return;
      }

      // A-G letter keys: pitch entry using current duration
      const upperKey = e.key.toUpperCase();
      if (PITCH_LETTERS.includes(upperKey) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        const durInfo = DURATION_MAP[currentDuration];
        if (!durInfo) return;

        // Resolve octave relative to last pitch and current clef
        const staff = score?.staves.find(s => s.id === stepEntry?.staffId);
        const clef = staff?.clef || "treble";
        const pitch = resolvePitch(upperKey, lastPitch, clef);

        // Handle accidentals: Shift+letter = sharp (could extend later)
        const tupletInfo = tupletMode ? { actualNotes: tupletMode.actualNotes, normalNotes: tupletMode.normalNotes } : undefined;
        placeNote(pitch, durInfo.dur, durInfo.beats, tupletInfo);
        setLastPitch(pitch);

        if (tupletMode) {
          const remaining = tupletMode.remaining - 1;
          if (remaining <= 0) setTupletMode(null);
          else setTupletMode({ ...tupletMode, remaining });
        }
        return;
      }

      // Up/Down arrows in step-entry: change octave of last pitch
      if ((e.key === "ArrowUp" || e.key === "ArrowDown") && e.shiftKey && lastPitch) {
        // Shift+Up/Down adjusts the octave hint for next letter-key entry
        const match = lastPitch.match(/^([A-G][b#]?)(\d+)$/);
        if (match) {
          const oct = parseInt(match[2]);
          const newOct = e.key === "ArrowUp" ? Math.min(8, oct + 1) : Math.max(1, oct - 1);
          setLastPitch(`${match[1]}${newOct}`);
        }
        // Don't prevent default — let page.tsx handle staff switching for plain Up/Down
        return;
      }

      // Number keys: set sticky duration (duration-first mode)
      // Also works as MIDI entry if a key is held
      const durInfo = DURATION_MAP[e.key];
      if (!durInfo) return;
      e.preventDefault();

      // If tuplet pending, set up tuplet with this number
      if (tupletPending) {
        const n = parseInt(e.key);
        if (n >= 2 && n <= 9) {
          setTupletMode({ actualNotes: n, normalNotes: n === 3 ? 2 : n === 5 || n === 6 ? 4 : n - 1, remaining: n });
          setTupletPending(false);
        }
        return;
      }

      // Always update current duration for letter-key entry
      setCurrentDuration(e.key);

      // Rest mode (space held + number = place rest immediately)
      if (spaceHeld) {
        const tupletInfo = tupletMode ? { actualNotes: tupletMode.actualNotes, normalNotes: tupletMode.normalNotes } : undefined;
        placeNote("rest", durInfo.dur, durInfo.beats, tupletInfo);
        if (tupletMode) {
          const remaining = tupletMode.remaining - 1;
          if (remaining <= 0) setTupletMode(null);
          else setTupletMode({ ...tupletMode, remaining });
        }
        return;
      }

      // MIDI key held + number = place note immediately (original behavior)
      if (activeKeysRef.current.size > 0) {
        const tupletInfo = tupletMode ? { actualNotes: tupletMode.actualNotes, normalNotes: tupletMode.normalNotes } : undefined;
        const keys = Array.from(activeKeysRef.current).sort();
        for (const midiNum of keys) {
          const pitch = midiNumberToPitch(midiNum);
          placeNote(pitch, durInfo.dur, durInfo.beats, tupletInfo);
          setLastPitch(pitch);
        }
        if (keys.length > 1) {
          const actualBeats = tupletInfo
            ? durInfo.beats * (tupletInfo.normalNotes / tupletInfo.actualNotes)
            : durInfo.beats;
          stepBack(actualBeats * (keys.length - 1));
        }
        if (tupletMode) {
          const remaining = tupletMode.remaining - 1;
          if (remaining <= 0) setTupletMode(null);
          else setTupletMode({ ...tupletMode, remaining });
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setSpaceHeld(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [stepEntry, score, spaceHeld, tupletMode, tupletPending, currentDuration, lastPitch, placeNote, addDotToLast, deleteLastNote, setStepEntry, stepBack]);

  return (
    <div className="flex items-center gap-2">
      {/* MIDI connect */}
      {!connected ? (
        <button
          onClick={connectMidi}
          className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded transition-colors"
          title="Connect MIDI keyboard"
        >
          MIDI
        </button>
      ) : (
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-green-500" title={deviceName || "Connected"} />
          <span className="text-[10px] text-gray-500 max-w-[80px] truncate">{deviceName}</span>
          {activeKeys.size > 0 && (
            <span className="text-[10px] text-blue-600 font-mono">
              {Array.from(activeKeys).sort().map(midiNumberToPitch).join(" ")}
            </span>
          )}
        </div>
      )}

      {/* Step-entry status (always on when score exists) */}
      {stepEntry && (
        <div className="flex items-center gap-1">
          {/* Duration selector: show which duration is active */}
          <span className="text-[10px] text-gray-400" title="Press 1-7 to set duration, then A-G to enter notes. Space+number for rest.">
            {Object.entries(DUR_LABELS).map(([k, v]) => (
              <span key={k} className={`mx-px ${k === currentDuration ? "text-blue-600 font-bold bg-blue-50 px-0.5 rounded" : ""}`}>{k}:{v}</span>
            ))}
          </span>

          {/* State indicators */}
          {spaceHeld && (
            <span className="text-[10px] text-purple-600 font-medium bg-purple-50 px-1 rounded">REST</span>
          )}
          {lyricMode && !lyricPending && (
            <span className="text-[10px] text-pink-600 font-medium bg-pink-50 px-1 rounded">LYR</span>
          )}
          {tupletPending && (
            <span className="text-[10px] text-teal-600 font-medium animate-pulse bg-teal-50 px-1 rounded">T:?</span>
          )}
          {tupletMode && (
            <span className="text-[10px] text-teal-600 font-medium bg-teal-50 px-1 rounded">
              {tupletMode.actualNotes}:{tupletMode.normalNotes} ({tupletMode.remaining} left)
            </span>
          )}
          {!connected && activeKeys.size === 0 && !spaceHeld && !lyricPending && (
            <span className="text-[10px] text-gray-400 italic">1-7 set duration, A-G enter notes</span>
          )}

          {/* Lyric input */}
          {lyricPending && (
            <input
              ref={lyricInputRef}
              type="text"
              value={lyricText}
              onChange={(e) => setLyricText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  commitLyric();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  skipLyric();
                }
              }}
              placeholder="lyric..."
              className="w-20 px-1 py-0.5 text-[10px] border border-pink-300 rounded focus:outline-none focus:border-pink-500"
            />
          )}

          {/* Lyric toggle */}
          <button
            onClick={() => setLyricMode(prev => !prev)}
            className={`px-1.5 py-0.5 text-[10px] font-medium rounded transition-colors ${
              lyricMode
                ? "text-white bg-pink-500 hover:bg-pink-600"
                : "text-pink-600 bg-pink-50 hover:bg-pink-100"
            }`}
            title="Toggle lyric entry (L)"
          >
            Lyric
          </button>
        </div>
      )}
    </div>
  );
}
