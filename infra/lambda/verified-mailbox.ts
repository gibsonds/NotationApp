import { RequestError } from './security';
/** Deliberately narrow ASCII mailbox contract; no display names or aliases guessed. */
export function normalizeMailbox(value: unknown): string {
  const email = typeof value === 'string' ? value.trim() : '';
  if (email.length > 254 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(email)) throw new RequestError(400,'Enter one valid email address.');
  const at=email.lastIndexOf('@');
  // Do not collapse local-part case, dots or plus aliases into another mailbox.
  return email.slice(0,at)+'@'+email.slice(at+1).toLowerCase();
}
/** Called ONLY on claims from the existing signature/issuer/audience/nonce-verified
 * ID token. Never takes identity from request JSON, a domain, or an access token. */
export function verifiedMailboxClaim(payload: Record<string, unknown>): string | undefined {
  if (process.env.VERIFIED_EMAIL_INVITES !== '1' || payload.email_verified !== true) return;
  try { return normalizeMailbox(payload.email); } catch { return; }
}
