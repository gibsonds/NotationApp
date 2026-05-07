"use client";

import { useEffect, useRef, useState } from "react";
import { submitFeedback, type FeedbackCategory } from "@/lib/feedback-store";

interface FeedbackModalProps {
  onClose: () => void;
}

const MAX_MESSAGE = 1000;
const MAX_EMAIL = 200;

const CATEGORIES: { value: FeedbackCategory; label: string }[] = [
  { value: "bug", label: "Bug" },
  { value: "feature", label: "Feature Request" },
  { value: "other", label: "Other" },
];

export default function FeedbackModal({ onClose }: FeedbackModalProps) {
  const [category, setCategory] = useState<FeedbackCategory>("bug");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      submitFeedback({
        category,
        message,
        email: email.trim() || undefined,
      });
      setDone(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not save feedback.";
      setError(msg);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh] bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl border border-gray-200 w-[480px] max-w-[92vw] flex flex-col overflow-hidden text-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-base font-semibold">Send Feedback</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-800 p-1 rounded"
            aria-label="Close"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {done ? (
          <div className="px-5 py-8 flex flex-col items-center text-center gap-3">
            <div className="w-12 h-12 rounded-full bg-green-100 text-green-600 flex items-center justify-center">
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-base font-medium">Thanks for your feedback!</p>
            <p className="text-sm text-gray-600">
              We read every submission and use it to make NotationApp better.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 px-4 py-3 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col">
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600 mb-2">
                  Category
                </label>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Feedback category">
                  {CATEGORIES.map((c) => {
                    const active = category === c.value;
                    return (
                      <button
                        key={c.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setCategory(c.value)}
                        className={`px-4 py-3 text-sm rounded-lg border transition-colors ${
                          active
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                        }`}
                      >
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label htmlFor="feedback-message" className="block text-xs font-semibold uppercase tracking-wider text-gray-600">
                    Message
                  </label>
                  <span className={`text-[11px] tabular-nums ${message.length > MAX_MESSAGE ? "text-red-600" : "text-gray-500"}`}>
                    {message.length}/{MAX_MESSAGE}
                  </span>
                </div>
                <textarea
                  id="feedback-message"
                  ref={textareaRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  required
                  maxLength={MAX_MESSAGE + 200}
                  rows={5}
                  placeholder="Tell us what's on your mind…"
                  className="w-full px-3 py-3 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
                />
              </div>

              <div>
                <label htmlFor="feedback-email" className="block text-xs font-semibold uppercase tracking-wider text-gray-600 mb-2">
                  Email <span className="font-normal normal-case text-gray-400">(optional, if you&apos;d like a reply)</span>
                </label>
                <input
                  id="feedback-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  maxLength={MAX_EMAIL}
                  placeholder="you@example.com"
                  className="w-full px-3 py-3 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {error && (
                <p className="text-sm text-red-600" role="alert">{error}</p>
              )}
            </div>

            <div className="px-5 py-3 border-t border-gray-200 bg-gray-50 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-3 text-sm text-gray-700 bg-white border border-gray-200 hover:bg-gray-100 active:bg-gray-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-3 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg transition-colors"
              >
                Send Feedback
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
