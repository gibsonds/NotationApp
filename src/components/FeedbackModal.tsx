"use client";

import { useEffect, useRef, useState } from "react";
import { submitFeedback, type FeedbackCategory } from "@/lib/feedback-store";

interface FeedbackModalProps {
  onClose: () => void;
}

const MAX_MESSAGE = 1000;
const MAX_EMAIL = 200;
const MAX_IMAGES = 3;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_IMAGE_DIM = 1200;
const JPEG_QUALITY = 0.7;
const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

const CATEGORIES: { value: FeedbackCategory; label: string }[] = [
  { value: "bug", label: "Bug" },
  { value: "feature", label: "Feature Request" },
  { value: "other", label: "Other" },
];

async function compressImage(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new window.Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("Failed to decode image"));
    im.src = dataUrl;
  });
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  if (w > MAX_IMAGE_DIM || h > MAX_IMAGE_DIM) {
    if (w >= h) {
      h = Math.round((h * MAX_IMAGE_DIM) / w);
      w = MAX_IMAGE_DIM;
    } else {
      w = Math.round((w * MAX_IMAGE_DIM) / h);
      h = MAX_IMAGE_DIM;
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

export default function FeedbackModal({ onClose }: FeedbackModalProps) {
  const [category, setCategory] = useState<FeedbackCategory>("bug");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const openFilePicker = () => {
    const input = fileInputRef.current;
    if (!input) return;
    // Set capture imperatively at click-time so SSR doesn't see a different
    // attribute than the client (would warn on hydration). On touch devices,
    // capture="environment" lets users take a photo directly.
    if (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) {
      input.setAttribute("capture", "environment");
    } else {
      input.removeAttribute("capture");
    }
    input.click();
  };

  const handleFiles = async (incoming: FileList | File[]) => {
    setImageError(null);
    let arr = Array.from(incoming);
    const remaining = MAX_IMAGES - images.length;
    if (remaining <= 0) {
      setImageError(`Maximum ${MAX_IMAGES} images.`);
      return;
    }
    if (arr.length > remaining) {
      setImageError(`Only the first ${remaining} added — max ${MAX_IMAGES} images per submission.`);
      arr = arr.slice(0, remaining);
    }
    for (const file of arr) {
      if (!file.type || !ACCEPTED_IMAGE_TYPES.includes(file.type)) {
        setImageError("Only PNG, JPEG, WebP, or GIF images are allowed.");
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        setImageError("Image is over 5MB. Please choose a smaller file.");
        continue;
      }
      try {
        const compressed = await compressImage(file);
        setImages((prev) => (prev.length >= MAX_IMAGES ? prev : [...prev, compressed]));
      } catch {
        setImageError("Could not process that image.");
      }
    }
  };

  const removeImage = (idx: number) => {
    setImages((prev) => prev.filter((_, i) => i !== idx));
    setImageError(null);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void handleFiles(e.dataTransfer.files);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      submitFeedback({
        category,
        message,
        email: email.trim() || undefined,
        images: images.length > 0 ? images : undefined,
      });
      setDone(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not save feedback.";
      setError(msg);
    }
  };

  const atImageLimit = images.length >= MAX_IMAGES;

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
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600 mb-2">
                  Screenshots <span className="font-normal normal-case text-gray-400">(optional, up to {MAX_IMAGES})</span>
                </label>
                <div
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onDrop={onDrop}
                  className={`border-2 border-dashed rounded-lg p-3 text-center transition-colors ${
                    isDragging ? "border-blue-500 bg-blue-50" : "border-gray-300 bg-white"
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPTED_IMAGE_TYPES.join(",")}
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        void handleFiles(e.target.files);
                      }
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    onClick={openFilePicker}
                    disabled={atImageLimit}
                    className="px-5 py-3 text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2 min-h-[44px]"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16l4-4 4 4 6-6 4 4M5 5h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z" />
                    </svg>
                    Attach screenshot
                  </button>
                  <p className="mt-2 text-xs text-gray-500">
                    Or drag &amp; drop — PNG, JPEG, WebP, or GIF up to 5MB
                  </p>
                </div>
                {images.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {images.map((src, idx) => (
                      <div key={idx} className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={src}
                          alt={`Screenshot ${idx + 1}`}
                          className="w-20 h-20 object-cover rounded-lg border border-gray-200"
                        />
                        <button
                          type="button"
                          onClick={() => removeImage(idx)}
                          className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-gray-800 text-white flex items-center justify-center hover:bg-black shadow"
                          aria-label={`Remove screenshot ${idx + 1}`}
                        >
                          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {imageError && (
                  <p className="mt-2 text-xs text-red-600" role="alert">{imageError}</p>
                )}
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
