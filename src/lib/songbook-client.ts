import { getAccessToken, loadMe, type Membership } from "@/lib/auth";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

async function request<T>(path: string, body: object): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new Error("Sign in before managing songbooks.");
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error("That invitation was not found or has expired.");
    if (response.status === 403) throw new Error("You do not have permission to change this songbook.");
    throw new Error(`Songbook request failed (${response.status}). Please try again.`);
  }
  return response.json() as Promise<T>;
}

export async function createSongbook(name: string): Promise<Membership> {
  const book = await request<Membership>("/songbooks", { name: name.trim() });
  await loadMe();
  return book;
}

export async function createSongbookInvite(id: string, role: "editor" | "viewer") {
  return request<{ token: string; expiresAt: number }>(`/songbooks/${encodeURIComponent(id)}/invites`, { role });
}

export async function joinSongbook(value: string): Promise<Membership> {
  let token = value.trim();
  try { token = new URL(token).searchParams.get("invite") ?? token; } catch { /* raw code */ }
  if (!/^[a-zA-Z0-9-]+$/.test(token)) throw new Error("Paste the invitation link or code.");
  const book = await request<Membership>(`/invites/${encodeURIComponent(token)}/accept`, {});
  await loadMe();
  return book;
}
