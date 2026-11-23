import { getAccessToken, COOKIE_SESSIONS, browserRequestHeaders, loadMe, getSnapshot, type Membership } from "@/lib/auth";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

async function request<T>(path: string, body: object): Promise<T> {
  const initial = getSnapshot();
  const token = await getAccessToken();
  if (!token) throw new Error("Sign in before managing songbooks.");
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(COOKIE_SESSIONS ? browserRequestHeaders() : { authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    if (path.startsWith('/invitations') && response.status === 409) throw new Error('Songbook access changed. No access was added. Review the invitation and try again.');
    if (path.startsWith('/invitations') && response.status === 503) throw new Error('Email invitations are not configured. No email was sent.');
    if (response.status === 404) throw new Error("That invitation was not found or has expired.");
    if (response.status === 403) throw new Error("You do not have permission to change this songbook.");
    throw new Error(`Songbook request failed (${response.status}). Please try again.`);
  }
  const value = await response.json() as T;
  const current = getSnapshot();
  if (path.startsWith('/invitations') && (initial.claims?.sub !== current.claims?.sub || initial.activeSongbookId !== current.activeSongbookId || initial.status !== current.status)) throw new Error('Your session changed. Review the invitation again.');
  return value;
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
  const token = invitationToken(value);
  if (token.startsWith('mi-')) throw new Error('Open this invitation link to review all selected songbooks before joining.');
  const book = await request<Membership>(`/invites/${encodeURIComponent(token)}/accept`, {});
  await loadMe();
  return book;
}

export interface SongbookMember { sub: string; role: "owner" | "editor" | "viewer"; addedAt: number; }
export async function listSongbookMembers(id: string): Promise<SongbookMember[]> {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}/songbooks/${encodeURIComponent(id)}/members`, { headers: COOKIE_SESSIONS ? browserRequestHeaders() : { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error("Could not load access list.");
  return (await res.json()).members;
}
export async function removeSongbookMember(id: string, sub: string): Promise<void> {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}/songbooks/${encodeURIComponent(id)}/members/${encodeURIComponent(sub)}`, { method:"DELETE", headers: COOKIE_SESSIONS ? browserRequestHeaders() : { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error("Could not remove access.");
}

export interface SharedBook { songbookId: string; name: string; role: 'viewer' }
export interface InvitationPreview { books: (SharedBook & {existingRole: Membership['role'] | null})[]; expiresAt: number; allMember: boolean }
export const MULTI_BOOK_INVITES = process.env.NEXT_PUBLIC_MULTI_BOOK_INVITES === '1';
async function invitationGet<T>(path: string): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new Error('Sign in to review this invitation.');
  const res = await fetch(`${API_BASE}${path}`, {cache:'no-store',headers:COOKIE_SESSIONS ? browserRequestHeaders() : {authorization:`Bearer ${token}`}});
  if (!res.ok) throw new Error('Invitation unavailable, expired, or for a different account. Sign in with the invited account or ask the owner for a new invitation.');
  return res.json();
}
export const invitationCapabilities = () => invitationGet<{emailDelivery:boolean}>('/invitations/capabilities');
export const previewInvitation = (token:string) => invitationGet<InvitationPreview>(`/invitations/${encodeURIComponent(token)}`);
export async function createBookInvitation(books:SharedBook[],requestId:string,recipientEmail?:string) {
  return request<{token:string;expiresAt:number;delivery:'sent'|'link'|'unconfirmed'}>('/invitations',{books,requestId,...(recipientEmail && {recipientEmail})});
}
export async function acceptBookInvitation(token:string): Promise<Membership[]> {
  const result = await request<{memberships:Membership[]}>(`/invitations/${encodeURIComponent(token)}/accept`,{});
  await loadMe();
  return result.memberships;
}

export function invitationToken(value:string):string {
  let token=value.trim();
  try {token=new URL(token).searchParams.get('invite')??token;} catch { /* raw code */ }
  if(!/^[a-zA-Z0-9-]{1,200}$/.test(token))throw new Error('Paste the invitation link or code.');
  return token;
}
