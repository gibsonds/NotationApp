/** Retired: debug messages must never create server-side content logs. */
export async function POST() {
  return new Response(null, { status: 404 });
}
