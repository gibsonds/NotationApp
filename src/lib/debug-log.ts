/** Local development diagnostics only; no browser telemetry endpoint. */
export function debugLog(msg: string): void {
  if (process.env.NODE_ENV !== "development") return;
  console.log(JSON.stringify({ debug: msg }));
}
