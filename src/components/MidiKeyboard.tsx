"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { MidiKeyboardInput, snapToNoteDuration, midiNumberToPitch } from "@/lib/midi-input";
import { useScoreStore } from "@/store/score-store";
import { Note } from "@/lib/schema";
import { v4 as uuidv4 } from "uuid";

interface RecordedNote {
  pitch: string;
  midiNumber: number;
  startTime: number;
  endTime?: number;
}

export default function MidiKeyboard() {
  const { score, applyPatches, addMessage } = useScoreStore();
  const [connected, setConnected] = useState(false);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [activeKeys, setActiveKeys] = useState<Set<number>>(new Set());
  const [recordedNotes, setRecordedNotes] = useState<RecordedNote[]>([]);

  const midiRef = useRef<MidiKeyboardInput | null>(null);
  const recordedRef = useRef<RecordedNote[]>([]);
  const recordingRef = useRef(false);
  recordingRef.current = recording;

  const connectMidi = useCallback(async () => {
    if (midiRef.current) {
      midiRef.current.disconnect();
    }

    const midi = new MidiKeyboardInput({
      onNoteOn: (pitch, velocity, midiNumber) => {
        setActiveKeys((prev) => new Set(prev).add(midiNumber));
        if (recordingRef.current) {
          const note: RecordedNote = {
            pitch,
            midiNumber,
            startTime: performance.now(),
          };
          recordedRef.current.push(note);
          setRecordedNotes([...recordedRef.current]);
        }
      },
      onNoteOff: (pitch, midiNumber) => {
        setActiveKeys((prev) => {
          const next = new Set(prev);
          next.delete(midiNumber);
          return next;
        });
        if (recordingRef.current) {
          // Find the matching note-on and close it
          for (let i = recordedRef.current.length - 1; i >= 0; i--) {
            if (recordedRef.current[i].midiNumber === midiNumber && !recordedRef.current[i].endTime) {
              recordedRef.current[i].endTime = performance.now();
              break;
            }
          }
          setRecordedNotes([...recordedRef.current]);
        }
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
    };
  }, []);

  const startRecording = () => {
    recordedRef.current = [];
    setRecordedNotes([]);
    setRecording(true);
  };

  const stopRecording = () => {
    setRecording(false);
    // Close any notes still held
    const now = performance.now();
    for (const note of recordedRef.current) {
      if (!note.endTime) note.endTime = now;
    }
    setRecordedNotes([...recordedRef.current]);

    if (recordedRef.current.length > 0) {
      insertRecordedNotes();
    }
  };

  const insertRecordedNotes = () => {
    if (!score || recordedRef.current.length === 0) return;

    const bpm = score.tempo || 120;
    const notes: Note[] = recordedRef.current.map((rn) => {
      const durationMs = (rn.endTime || performance.now()) - rn.startTime;
      const { duration, dots } = snapToNoteDuration(durationMs, bpm);

      // For now, start at measure 1, beat 1 — user can move them later
      // In future: calculate measure/beat from recording timeline
      return {
        pitch: rn.pitch,
        duration,
        dots,
        accidental: "none" as const,
        tieStart: false,
        tieEnd: false,
        measure: 1,
        beat: 1,
      };
    });

    // Place notes sequentially starting at measure 1
    const [beatsStr, beatTypeStr] = score.timeSignature.split("/");
    const beatsPerMeasure = parseInt(beatsStr) * (4 / parseInt(beatTypeStr));
    let currentBeat = 1;
    let currentMeasure = 1;

    const DUR_BEATS: Record<string, number> = {
      whole: 4, half: 2, quarter: 1, eighth: 0.5, sixteenth: 0.25,
    };

    for (const note of notes) {
      note.measure = currentMeasure;
      note.beat = currentBeat;

      const noteBeats = DUR_BEATS[note.duration] * (note.dots ? 1.5 : 1);
      currentBeat += noteBeats;

      while (currentBeat > beatsPerMeasure + 1) {
        currentBeat -= beatsPerMeasure;
        currentMeasure++;
      }
    }

    // Add to first staff, first voice
    const staff = score.staves[0];
    const voice = staff?.voices[0];
    if (staff && voice) {
      applyPatches([{
        op: "set_notes",
        staffId: staff.id,
        voiceId: voice.id,
        notes,
      }]);
      addMessage({
        id: uuidv4(),
        role: "assistant",
        content: `Recorded ${notes.length} notes from MIDI keyboard.`,
        timestamp: Date.now(),
      });
    }
  };

  return (
    <div className="flex items-center gap-2">
      {!connected ? (
        <button
          onClick={connectMidi}
          className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded transition-colors"
          title="Connect MIDI keyboard"
        >
          MIDI
        </button>
      ) : (
        <>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-green-500" title={deviceName || "Connected"} />
            <span className="text-[10px] text-gray-500 max-w-[80px] truncate">{deviceName}</span>
          </div>
          {activeKeys.size > 0 && (
            <span className="text-[10px] text-blue-600 font-mono">
              {Array.from(activeKeys).map(midiNumberToPitch).join(" ")}
            </span>
          )}
          {!recording ? (
            <button
              onClick={startRecording}
              disabled={!score}
              className="px-2 py-1 text-[10px] font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded disabled:opacity-30 transition-colors"
            >
              Record
            </button>
          ) : (
            <button
              onClick={stopRecording}
              className="px-2 py-1 text-[10px] font-medium text-white bg-red-500 hover:bg-red-600 rounded animate-pulse transition-colors"
            >
              Stop ({recordedNotes.length})
            </button>
          )}
        </>
      )}
    </div>
  );
}
