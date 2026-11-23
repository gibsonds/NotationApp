"use client";

import MultiBookInviteFlow from "./MultiBookInviteFlow";
import { useState } from "react";
import { beginSignIn, getSnapshot, setActiveSongbook } from "@/lib/auth";
import { joinSongbook } from "@/lib/songbook-client";
import InviteLanding from "./InviteLanding";

type Props = { token: string; ready: boolean; signedIn: boolean; authError?: string; onLeave: () => void };

export default function SongbookInviteFlow({ token, ready, signedIn, authError, onLeave }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tried, setTried] = useState(false);
  async function advance() {
    if (busy) return;
    setBusy(true);
    setError("");
    setTried(true);
    try {
      if (!signedIn) {
        await beginSignIn();
        return;
      }
      const joined = await joinSongbook(token);
      if (!getSnapshot().memberships.some(book => book.songbookId === joined.songbookId)) {
        throw new Error("You joined, but Charts couldn’t open the book. Go back and find it in File → My Songs.");
      }
      onLeave();
      setActiveSongbook(joined.songbookId);
    } catch (err) {
      setError(signedIn && err instanceof Error ? err.message : "Couldn’t open sign-in. Please try again.");
      setBusy(false);
    }
  }
  if (token.startsWith("mi-")) return <MultiBookInviteFlow token={token} ready={ready} signedIn={signedIn} authError={authError} onLeave={onLeave} />;
  return <InviteLanding phase={!ready ? "loading" : signedIn ? "join" : "sign-in"} busy={busy}
    error={error || (!tried ? authError : "")}
    onContinue={advance} onLeave={onLeave} />;
}
