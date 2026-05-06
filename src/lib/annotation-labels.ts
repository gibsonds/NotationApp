const STORAGE_KEY = "notation-app-annotation-labels";
const DEFAULT_LABELS = ["Guitar", "Voice", "Drums"];

export function getAnnotationLabels(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...DEFAULT_LABELS];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as string[];
  } catch {}
  return [...DEFAULT_LABELS];
}

export function saveAnnotationLabel(label: string): void {
  const labels = getAnnotationLabels();
  if (!labels.includes(label)) {
    labels.push(label);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(labels)); } catch {}
  }
}

export function deleteAnnotationLabel(label: string): void {
  const labels = getAnnotationLabels().filter((l) => l !== label);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(labels)); } catch {}
}
