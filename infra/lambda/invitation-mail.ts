/** Reviewed subset of the staged Brevo transport. No confirmation-code second
 * email: recipient binding comes solely from the verified session mailbox. */
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { RequestError } from './security';
import { normalizeMailbox } from './verified-mailbox';
import type { MultiInvite } from './multi-invites';
export type MailConfig = {apiKey:string; sender:string; origin:string};
const secrets = new SecretsManagerClient({});
export const emailInvitesEnabled = () => process.env.VERIFIED_EMAIL_INVITES === '1' && !!process.env.BREVO_INVITE_SECRET_ID;
export async function mailConfig(): Promise<MailConfig> {
  if (!emailInvitesEnabled()) throw new RequestError(503,'Email invitations require verified recipient identity and a configured sender.');
  try {
    const raw = await secrets.send(new GetSecretValueCommand({SecretId:process.env.BREVO_INVITE_SECRET_ID}));
    const c = JSON.parse(raw.SecretString ?? '');
    if (typeof c.apiKey !== 'string' || !c.apiKey || typeof c.origin !== 'string' || !c.origin.startsWith('https://') || new URL(c.origin).origin !== c.origin || !(process.env.APP_ORIGINS ?? '').split(',').includes(c.origin)) throw Error();
    return {apiKey:c.apiKey,sender:normalizeMailbox(c.sender),origin:c.origin};
  } catch { throw new RequestError(503,'Email invitations are not configured. No invitation email was sent.'); }
}
const escape = (s:string) => s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function invitationMessage(config: MailConfig, invite: MultiInvite) {
  const url = new URL('/',config.origin); url.searchParams.set('invite',invite.token);
  const guidance = 'Open this link to continue to Charts sign-in. If you are new, use the account creation option offered on the sign-in screen, then return to this invitation. Existing users can sign in if needed. Use the email address receiving this invitation. Review the selected songbooks and choose Join once. Your existing access stays unchanged, even if the invitation offers a different role. Editor can add and change songs; Viewer can read them. This invitation cannot transfer ownership or remove songs. This invitation expires after 48 hours.';
  return {subject:'Your Charts songbook invitation',
    textContent:`You are invited to these songbooks:\n${invite.books.map(b=>`• ${b.name} — ${b.role} for new members`).join('\n')}\n\n${url}\n\n${guidance}`,
    htmlContent:`<p>You are invited to these Charts songbooks:</p><ul>${invite.books.map(b=>`<li>${escape(b.name)} — ${b.role} for new members</li>`).join('')}</ul><p><a href="${escape(url.toString())}">Open invitation</a></p><p>${escape(guidance)}</p>`};
}
export async function sendInvitation(config: MailConfig, invite: MultiInvite, fetcher = fetch): Promise<void> {
  if (!invite.recipientEmail) throw new RequestError(400,'A verified recipient mailbox is required for email.');
  try {
    const res = await fetcher('https://api.brevo.com/v3/smtp/email',{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{'api-key':config.apiKey,'content-type':'application/json'},body:JSON.stringify({sender:{name:'InferMusic Charts',email:config.sender},to:[{email:invite.recipientEmail}],...invitationMessage(config,invite)})});
    if (!res.ok) throw Error();
  } catch { throw new RequestError(502,'Email delivery could not be confirmed. This invitation will not be sent again automatically.'); }
}
