"use client";

import { useEffect, useState } from "react";
import {
  AiProvider,
  clearApiKey,
  getApiKey,
  maskKey,
  setApiKey,
  validateKeyFormat,
} from "@/lib/api-key-store";

interface ApiKeyModalProps {
  onClose: () => void;
}

const PROVIDER_LABEL: Record<AiProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
};

const PROVIDER_DOCS: Record<AiProvider, { url: string; label: string }> = {
  anthropic: { url: "https://docs.anthropic.com/en/docs/get-api-key", label: "docs.anthropic.com" },
  openai: { url: "https://platform.openai.com/api-keys", label: "platform.openai.com" },
};

const PROVIDER_HINT: Record<AiProvider, string> = {
  anthropic: "This doesn't look like a valid Anthropic key (expected sk-ant-…).",
  openai: "This doesn't look like a valid OpenAI key (expected sk-…).",
};

function logEvent(event: "api_key_set" | "api_key_removed", provider: AiProvider): void {
  // Provider-only telemetry. The raw key value MUST NEVER appear here. If we
  // ever add a real analytics module (`src/lib/analytics.ts`), wire it up
  // here — but keep this function passing only `{ provider }`.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    if (typeof w?.analytics?.track === "function") w.analytics.track(event, { provider });
  } catch {
    // Telemetry must never break the user-facing flow.
  }
}

export default function ApiKeyModal({ onClose }: ApiKeyModalProps) {
  const [provider, setProvider] = useState<AiProvider>("anthropic");
  const [draft, setDraft] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bump to force a re-read of the store after save/remove.
  const [storeRevision, setStoreRevision] = useState(0);
  const [savedFlash, setSavedFlash] = useState(false);

  const storedKey = (() => {
    void storeRevision;
    return getApiKey(provider);
  })();

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const switchProvider = (p: AiProvider) => {
    setProvider(p);
    setDraft("");
    setError(null);
    setShow(false);
    setSavedFlash(false);
  };

  const handleSave = () => {
    setError(null);
    if (!validateKeyFormat(provider, draft)) {
      setError(PROVIDER_HINT[provider]);
      return;
    }
    setApiKey(provider, draft.trim());
    logEvent("api_key_set", provider);
    setStoreRevision((r) => r + 1);
    setDraft("");
    setShow(false);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1500);
  };

  const handleRemove = () => {
    clearApiKey(provider);
    logEvent("api_key_removed", provider);
    setStoreRevision((r) => r + 1);
    setDraft("");
    setShow(false);
  };

  const docs = PROVIDER_DOCS[provider];

  return (
    <div
      className="fixed inset-0 z-[1000] bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white text-gray-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h2 className="text-base font-semibold">API Keys</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-xl leading-none"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Provider tabs */}
        <div className="flex border-b border-gray-200 bg-gray-50">
          {(Object.keys(PROVIDER_LABEL) as AiProvider[]).map((p) => (
            <button
              key={p}
              onClick={() => switchProvider(p)}
              className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
                provider === p
                  ? "bg-white text-gray-900 border-b-2 border-blue-500"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {PROVIDER_LABEL[p]}
            </button>
          ))}
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Privacy info box — prominent */}
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-[12px] text-blue-900 leading-relaxed">
            <span className="font-semibold">Your API key is stored only in this browser.</span>{" "}
            It is never sent to our servers.
          </div>

          {/* Stored key (if any) */}
          {storedKey && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-0.5">
                  Saved key
                </div>
                <div className="font-mono text-sm text-gray-700 truncate">
                  {maskKey(storedKey)}
                </div>
              </div>
              <button
                onClick={handleRemove}
                className="shrink-0 px-2.5 py-1 text-xs font-medium text-red-600 border border-red-200 rounded-md hover:bg-red-50"
              >
                Remove Key
              </button>
            </div>
          )}

          {/* Input */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              {storedKey ? "Replace key" : `${PROVIDER_LABEL[provider]} API key`}
            </label>
            <div className="relative">
              <input
                type={show ? "text" : "password"}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  if (error) setError(null);
                }}
                placeholder={provider === "anthropic" ? "sk-ant-…" : "sk-…"}
                autoComplete="off"
                spellCheck={false}
                className="w-full px-3 py-2 pr-16 text-sm font-mono border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-medium text-gray-500 hover:text-gray-700 px-1.5 py-0.5"
              >
                {show ? "Hide" : "Show"}
              </button>
            </div>
            {error && (
              <p className="mt-1.5 text-xs text-red-600">{error}</p>
            )}
            <p className="mt-2 text-[11px] text-gray-500">
              Get your key at{" "}
              <a
                href={docs.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                {docs.label}
              </a>
              .
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-1">
            {savedFlash && (
              <span className="text-xs text-green-600 mr-auto">Saved.</span>
            )}
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded-md"
            >
              Close
            </button>
            <button
              onClick={handleSave}
              disabled={!draft.trim()}
              className="px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Save Key
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
