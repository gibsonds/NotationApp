/** Versioned, bounded invitations. One transaction grants every selected book or none.
 * Legacy single-book tokens and tables remain unchanged. No song data is copied. */
import { createHash, randomUUID } from 'node:crypto';
import { GetCommand, TransactWriteCommand, type TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE, type Item } from './ddb';
import { identifier, RequestError } from './security';
import type { AuthedUser } from './auth';
import type { Membership } from './songbook-types';
import { normalizeMailbox } from './verified-mailbox';

type Operation = NonNullable<TransactWriteCommandInput['TransactItems']>[number];
export interface SelectedBook { songbookId: string; name: string; role: 'viewer' | 'editor' }
interface Book extends SelectedBook { createdAt: number }
export interface MultiInvite {
  token: string; createdBy: string; createdAt: number; expiresAt: number;
  books: Book[]; recipientEmail?: string; acceptedBy?: string;
  deliveryState?: 'attempted' | 'sent';
}
export interface InvitationPreview { books: (SelectedBook & { existingRole: Membership['role'] | null; effectiveRole: Membership['role'] })[]; expiresAt: number; allMember: boolean }
const TTL = 48 * 3600_000;
export const MAX_INVITE_BOOKS = 10;
const pk = (id: string) => `SONGBOOK#${id}`;
const userPk = (sub: string) => `USER#${sub}`;
const inviteKey = (token: string) => ({ pk: `MULTIINVITE#${identifier(token)}`, sk: 'META' });
const unavailable = () => new RequestError(404, 'Invitation unavailable, expired, or for a different account.');
const changed = () => new RequestError(409, 'Songbook access changed. No access was added. Review the invitation and try again.');
async function read(Key: { pk: string; sk: string }): Promise<Item | undefined> {
  return (await ddb.send(new GetCommand({ TableName: TABLE, Key, ConsistentRead: true }))).Item;
}
function check(Key: {pk: string; sk: string}, ConditionExpression: string, ExpressionAttributeValues?: Record<string, unknown>, ExpressionAttributeNames?: Record<string, string>): Operation {
  return { ConditionCheck: { TableName: TABLE, Key, ConditionExpression, ...(ExpressionAttributeValues && { ExpressionAttributeValues }), ...(ExpressionAttributeNames && { ExpressionAttributeNames }) } };
}
const metaCheck = (book: Book) => check({pk: pk(book.songbookId), sk: 'META'}, '#n = :name AND createdAt = :created', { ':name': book.name, ':created': book.createdAt }, {'#n': 'name'});
const ownerCheck = (book: Book, sub: string) => check({pk:userPk(sub), sk:`MEMBER#${book.songbookId}`}, '#r = :owner', {':owner':'owner'}, {'#r':'role'});
function selection(value: unknown): SelectedBook[] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_INVITE_BOOKS) throw new RequestError(400, 'Select between 1 and 10 songbooks.');
  const books = value.map((v: unknown): SelectedBook => {
    if (!v || typeof v !== 'object') throw new RequestError(400, 'Invalid selection.');
    const b = v as Record<string, unknown>;
    const role = b.role === undefined ? 'viewer' : b.role;
    if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 120 || (role !== 'viewer' && role !== 'editor') || Object.keys(b).some(k=>!['songbookId','name','role'].includes(k))) throw new RequestError(400, 'Each book must specify only its ID, name and Viewer or Editor role.');
    return { songbookId: identifier(typeof b.songbookId === 'string' ? b.songbookId : undefined), name: b.name, role };
  }).sort((a,b) => a.songbookId.localeCompare(b.songbookId));
  if (new Set(books.map(b=>b.songbookId)).size !== books.length) throw new RequestError(400, 'Select each songbook once.');
  return books;
}
export async function createMultiInvite(sub: string, value: unknown, requestId: string, recipient?: string): Promise<MultiInvite> {
  if (!/^[a-f0-9-]{36}$/.test(requestId)) throw new RequestError(400, 'Invalid invitation request.');
  const selected = selection(value);
  const recipientEmail = recipient === undefined ? undefined : normalizeMailbox(recipient);
  const fingerprint = createHash('sha256').update(JSON.stringify([selected, recipientEmail ?? null])).digest('hex');
  const requestKey = {pk:userPk(sub), sk:`INVITATIONREQUEST#${requestId}`};
  const prior = await read(requestKey);
  if (prior) {
    if (prior.fingerprint !== fingerprint) throw new RequestError(409, 'This request was already used for a different invitation.');
    const existing = await read(inviteKey(prior.token));
    if (!existing || existing.expiresAt <= Date.now()) throw unavailable();
    await validateBooks(existing as unknown as MultiInvite);
    return existing as unknown as MultiInvite;
  }
  const books: Book[] = [];
  for (const book of selected) {
    const meta = await read({pk:pk(book.songbookId),sk:'META'});
    if (!meta || meta.name !== book.name || typeof meta.createdAt !== 'number') throw changed();
    books.push({...book, createdAt:meta.createdAt});
  }
  const now = Date.now();
  const invite: MultiInvite = {token:`mi-${randomUUID()}`,createdBy:sub,createdAt:now,expiresAt:now+TTL,books,...(recipientEmail && {recipientEmail})};
  try {
    await ddb.send(new TransactWriteCommand({TransactItems:[
      {Put:{TableName:TABLE,Item:{...inviteKey(invite.token),...invite,ttl:Math.ceil(invite.expiresAt/1000)},ConditionExpression:'attribute_not_exists(pk)'}},
      {Put:{TableName:TABLE,Item:{...requestKey,token:invite.token,fingerprint,ttl:Math.ceil((now+7*86400_000)/1000)},ConditionExpression:'attribute_not_exists(pk)'}},
      ...books.flatMap(b=>[ownerCheck(b,sub),metaCheck(b)]),
    ]}));
  } catch (err) {
    if ((err as Error).name !== 'TransactionCanceledException') throw err;
    // A concurrent identical submission can have succeeded; never issue twice.
    const won = await read(requestKey);
    if (won?.fingerprint === fingerprint) {
      const existing = await read(inviteKey(won.token));
      if (existing && existing.expiresAt > Date.now()) { await validateBooks(existing as unknown as MultiInvite); return existing as unknown as MultiInvite; }
    }
    throw changed();
  }
  return invite;
}
async function getInvite(token: string, user: AuthedUser): Promise<MultiInvite> {
  const invite = await read(inviteKey(token)) as unknown as MultiInvite | undefined;
  if (!invite || !Array.isArray(invite.books) || !invite.books.length || invite.books.length > MAX_INVITE_BOOKS || invite.expiresAt <= Date.now()) throw unavailable();
  if (invite.books.some(b=>!b || (b.role !== 'viewer' && b.role !== 'editor') || typeof b.songbookId !== 'string' || typeof b.name !== 'string' || typeof b.createdAt !== 'number') || new Set(invite.books.map(b=>b.songbookId)).size !== invite.books.length) throw unavailable();
  if (invite.recipientEmail && (process.env.VERIFIED_EMAIL_INVITES !== '1' || !user.verifiedEmail || normalizeMailbox(user.verifiedEmail) !== invite.recipientEmail)) throw unavailable();
  if (invite.acceptedBy && invite.acceptedBy !== user.sub) throw unavailable();
  return invite;
}
async function validateBooks(invite: MultiInvite): Promise<void> {
  for (const book of invite.books) {
    const meta = await read({pk:pk(book.songbookId),sk:'META'});
    const owner = await read({pk:userPk(invite.createdBy),sk:`MEMBER#${book.songbookId}`});
    if (!meta || meta.name !== book.name || meta.createdAt !== book.createdAt || owner?.role !== 'owner') throw changed();
  }
}
async function inspect(invite: MultiInvite, user: AuthedUser) {
  const operations: Operation[] = [];
  const memberships: Membership[] = [];
  const preview: InvitationPreview = {books:[],expiresAt:invite.expiresAt,allMember:true};
  for (const book of invite.books) {
    const meta = await read({pk:pk(book.songbookId),sk:'META'});
    const owner = await read({pk:userPk(invite.createdBy),sk:`MEMBER#${book.songbookId}`});
    if (!meta || meta.name !== book.name || meta.createdAt !== book.createdAt || owner?.role !== 'owner') throw changed();
    const memberKey = {pk:userPk(user.sub),sk:`MEMBER#${book.songbookId}`};
    const mirrorKey = {pk:pk(book.songbookId),sk:`MEMBER#${user.sub}`};
    const existing = await read(memberKey);
    const mirror = await read(mirrorKey);
    if (user.sub === invite.createdBy && existing?.role !== 'owner') throw changed();
    if (Boolean(existing) !== Boolean(mirror) || (existing && (existing.role !== mirror?.role || existing.addedAt !== mirror?.addedAt || !['viewer','editor','owner'].includes(existing.role)))) throw changed();
    const membership: Membership = {songbookId:book.songbookId,name:book.name,role:existing?.role ?? book.role,addedAt:existing?.addedAt ?? Date.now()};
    memberships.push(membership);
    preview.books.push({...book,existingRole:existing?.role ?? null,effectiveRole:membership.role});
    preview.allMember &&= !!existing;
    operations.push(metaCheck(book));
    // If the recipient is also the creator, the membership condition below already
    // verifies owner. DynamoDB forbids two operations against the same item.
    if (user.sub !== invite.createdBy) operations.push(ownerCheck(book,invite.createdBy));
    if (existing) {
      const condition = '#r = :role AND addedAt = :added';
      const vals = {':role':existing.role,':added':existing.addedAt};
      operations.push(check(memberKey,condition,vals,{'#r':'role'}),check(mirrorKey,condition,vals,{'#r':'role'}));
    } else {
      if (invite.acceptedBy) throw changed(); // Receipt retries never recreate removed access.
      operations.push(check({pk:pk(book.songbookId),sk:`REMOVED#${user.sub}`}, 'attribute_not_exists(pk) OR removedAt < :created', {':created':invite.createdAt}));
      operations.push(
        {Put:{TableName:TABLE,Item:{...memberKey,entity:'Membership',...membership},ConditionExpression:'attribute_not_exists(pk)'}},
        {Put:{TableName:TABLE,Item:{...mirrorKey,entity:'Member',sub:user.sub,role:membership.role,addedAt:membership.addedAt},ConditionExpression:'attribute_not_exists(pk)'}},
      );
    }
  }
  return {preview,operations,memberships};
}
export async function previewMultiInvite(token: string, user: AuthedUser): Promise<InvitationPreview> {
  return (await inspect(await getInvite(token,user),user)).preview;
}
export async function acceptMultiInvite(token: string, user: AuthedUser): Promise<{memberships:Membership[]}> {
  const invite = await getInvite(token,user);
  const state = await inspect(invite,user);
  if (invite.acceptedBy) return {memberships:state.memberships};
  try {
    await ddb.send(new TransactWriteCommand({TransactItems:[
      {Update:{
        TableName:TABLE, Key:inviteKey(token), UpdateExpression:'SET acceptedBy = :sub',
        // The persisted book-role pairs and recipient must still match the
        // verified snapshot used to plan every membership in this transaction.
        ConditionExpression:'attribute_not_exists(acceptedBy) AND expiresAt > :now AND #books = :books AND createdBy = :creator AND createdAt = :created AND expiresAt = :expires AND '+
          (invite.recipientEmail ? 'recipientEmail = :recipient' : 'attribute_not_exists(recipientEmail)'),
        ExpressionAttributeNames:{'#books':'books'},
        ExpressionAttributeValues:{
          ':sub':user.sub, ':now':Date.now(), ':books':invite.books,
          ':creator':invite.createdBy, ':created':invite.createdAt, ':expires':invite.expiresAt,
          ...(invite.recipientEmail && {':recipient':invite.recipientEmail}),
        },
      }},
      ...state.operations,
    ]}));
  } catch (err) {
    if ((err as Error).name !== 'TransactionCanceledException') throw err;
    const won = await getInvite(token,user);
    if (won.acceptedBy === user.sub) return {memberships:(await inspect(won,user)).memberships};
    throw changed();
  }
  return {memberships:state.memberships};
}
/** Claim delivery once BEFORE calling an external transport. An ambiguous provider
 * outcome must never cause automatic duplicate sends on refresh/retry. */
export async function claimInviteDelivery(token: string): Promise<boolean> {
  try {
    await ddb.send(new TransactWriteCommand({TransactItems:[{Update:{TableName:TABLE,Key:inviteKey(token),UpdateExpression:'SET deliveryState = :state',ConditionExpression:'attribute_exists(pk) AND attribute_not_exists(deliveryState) AND expiresAt > :now',ExpressionAttributeValues:{':state':'attempted',':now':Date.now()}}}]}));
    return true;
  } catch(err) { if ((err as Error).name === 'TransactionCanceledException') return false; throw err; }
}
export async function markInviteSent(token: string): Promise<void> {
  await ddb.send(new TransactWriteCommand({TransactItems:[{Update:{TableName:TABLE,Key:inviteKey(token),UpdateExpression:'SET deliveryState = :state',ConditionExpression:'deliveryState = :attempted',ExpressionAttributeValues:{':state':'sent',':attempted':'attempted'}}}]}));
}
