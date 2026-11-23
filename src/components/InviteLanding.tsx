"use client";

import { useEffect, useRef } from "react";

type Props = {
  phase: "loading" | "sign-in" | "join";
  busy?: boolean;
  error?: string;
  onContinue?: () => void;
  onLeave?: () => void;
  multiple?: boolean;
  books?: {songbookId:string;name:string;role:string;existingRole:string|null}[];
  disableContinue?: boolean;
  onSwitchAccount?: () => void;
};

export default function InviteLanding({ phase, busy, error, onContinue, onLeave, multiple, books, disableContinue, onSwitchAccount }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (phase !== "loading") heading.current?.focus();
  }, [phase]);

  const action = phase === "join" ? (multiple ? "Join selected songbooks" : "Join songbook") : "Continue to sign in";
  const progress = phase === "join" ? "Joining…" : "Opening sign-in…";
  return (
    <main className="min-h-dvh bg-[#f3f5fb] px-5 py-10 text-[#14182d] sm:grid sm:place-content-center sm:px-8">
      <div className="mx-auto w-full max-w-[28rem]">
        <div className="mb-6 flex items-center gap-3 sm:mb-8">
          <span aria-hidden="true" className="grid size-10 place-items-center rounded-xl bg-[#182442] text-white">
            <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 17V5l11-2v12M9 17c0 1.1-1.3 2-3 2s-3-.9-3-2 1.3-2 3-2 3 .9 3 2Zm11-2c0 1.1-1.3 2-3 2s-3-.9-3-2 1.3-2 3-2 3 .9 3 2Z" />
            </svg>
          </span>
          <span className="text-[17px] font-semibold tracking-tight">InferMusic <span className="text-[#516287]">Charts</span></span>
        </div>
        <section aria-labelledby="charts-invite-title" className="rounded-3xl border border-[#dce3f2] bg-white px-6 py-8 shadow-[0_16px_50px_-35px_#384c7c] sm:px-9 sm:py-10">
          <p className="mb-3 text-xs font-bold tracking-[0.13em] text-[#2d56a6] uppercase">Private invitation</p>
          <h1 ref={heading} tabIndex={-1} id="charts-invite-title" className="text-[2rem] leading-[1.12] font-semibold tracking-[-0.04em] outline-none sm:text-4xl">{multiple ? "Join shared songbooks" : "Join a shared songbook"}</h1>
          {phase === "loading" ? (
            <p role="status" className="mt-4 text-base leading-relaxed text-[#4b5873]">Checking sign-in…</p>
          ) : (
            <>
              <p className="mt-4 text-base leading-relaxed text-[#4b5873]">
                {phase === "join" ? "You’re signed in. Review the invitation, then join to open the charts." : "Sign in to Charts to join. New here? Use the account creation option offered on the sign-in screen. You’ll return to this invitation."}
              </p>
              {books && <ul aria-label="Invited songbooks" className="mt-4 divide-y">{books.map(book=><li key={book.songbookId} className="py-3 break-words">{book.name}<span className="block text-sm text-[#4b5873]">{book.existingRole ? `Already a member · ${book.existingRole} access stays unchanged` : `${book.role} access`}</span></li>)}</ul>}
              {multiple && phase === 'join' && !books && !error && <p role="status" className="mt-4">Checking invitation…</p>}
              <button type="button" onClick={onContinue} disabled={busy || disableContinue} className="mt-7 min-h-12 w-full rounded-xl bg-[#1c54c6] px-5 py-3 font-semibold text-white transition hover:bg-[#1746a9] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1c54c6] disabled:opacity-65">
                {busy ? progress : action}
              </button>
              {onSwitchAccount && <button type="button" onClick={onSwitchAccount} disabled={busy} className="mt-3 min-h-11 px-2 text-sm underline">Use a different account</button>}
              {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm leading-relaxed text-red-800">{error}</p>}
            </>
          )}
        </section>
        {phase !== "loading" && <button type="button" onClick={onLeave} disabled={busy} className="mt-3 min-h-11 rounded-md px-2 text-sm font-medium text-[#415579] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1c54c6] disabled:opacity-55">Back to Charts</button>}
      </div>
    </main>
  );
}
