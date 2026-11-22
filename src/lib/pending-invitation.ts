const INVITE_KEY = "notation-app-pending-invite";

export function readPendingInvitation(): string {
  const url = new URL(window.location.href);
  const supplied = url.searchParams.get("invite");
  let token = supplied || "";
  try {
    if (supplied) {
      sessionStorage.setItem(INVITE_KEY, supplied);
      url.searchParams.delete("invite");
      window.history.replaceState(null, "", url);
    } else {
      token = sessionStorage.getItem(INVITE_KEY) ?? "";
    }
  } catch { /* Preserve the supplied URL if browser storage is unavailable. */ }
  return token;
}

export function clearPendingInvitation(): void {
  try { sessionStorage.removeItem(INVITE_KEY); } catch { /* no storage */ }
  const url = new URL(window.location.href);
  url.searchParams.delete("invite");
  window.history.replaceState(null, "", url);
}
