/** Post debug messages to /api/debug which writes to /tmp/notation-debug.log */
export function debugLog(msg: string): void {
  if (process.env.NODE_ENV !== "development") return;
  console.log(msg);
  fetch("/api/debug", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msg }),
  }).catch(() => {});
}
