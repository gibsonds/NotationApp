/** Revocable sessions retain only a hashed random credential, opaque subject and expiry.
 * OAuth access/refresh/ID tokens are discarded after verifying sign-in. */
import { createHash, randomBytes } from 'node:crypto';
import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { ddb } from './ddb';
import { AuthError, verifyAccessToken, verifyIdToken, type AuthedUser } from './auth';

const COOKIE = '__Host-notation-session';
const MAX_AGE = 12 * 3600;
const sessionTable = () => process.env.SESSION_TABLE_NAME!;
const hash = (id: string) => createHash('sha256').update(id).digest('hex');
export function sessionId(event: APIGatewayProxyEventV2): string | null {
  const cookies = event.cookies ?? (event.headers.cookie ?? '').split(';');
  const value = cookies.map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
export function sessionCookie(id: string, age = MAX_AGE) {
  return `${COOKIE}=${id}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`;
}
export function assertBrowserRequest(event: APIGatewayProxyEventV2) {
  const allowed = (process.env.APP_ORIGINS ?? '').split(',').filter(Boolean);
  if (!allowed.includes(event.headers.origin ?? '') || event.headers['x-notation-request'] !== '1') {
    throw new AuthError(403, 'untrusted browser request');
  }
}
export async function createSession(tokens: Record<string, unknown>, nonce: string) {
  if (typeof tokens.id_token !== 'string') throw new AuthError(401, 'missing sign-in token');
  const { payload } = await verifyIdToken(tokens.id_token, nonce);
  return storeSession(payload.sub!);
}
export async function migrateAccessToken(token: string) {
  const { payload } = await verifyAccessToken(token);
  return storeSession(payload.sub!);
}
async function storeSession(sub: string) {
  const id = randomBytes(32).toString('base64url');
  const ttl = Math.floor(Date.now() / 1000) + MAX_AGE;
  await ddb.send(new PutCommand({ TableName: sessionTable(), Item: { id: hash(id), sub, ttl } }));
  return { cookie: sessionCookie(id), sub };
}
export async function deleteSession(event: APIGatewayProxyEventV2) {
  const id = sessionId(event);
  if (id) await ddb.send(new DeleteCommand({ TableName: sessionTable(), Key: { id: hash(id) } }));
}
export async function sessionUser(event: APIGatewayProxyEventV2): Promise<AuthedUser> {
  const id = sessionId(event);
  if (!id) throw new AuthError(401, 'sign in required');
  const result = await ddb.send(new GetCommand({ TableName: sessionTable(), Key: {id:hash(id)}, ConsistentRead: true }));
  const session = result.Item;
  if (!session || typeof session.sub !== 'string' || session.ttl <= Date.now()/1000) throw new AuthError(401, 'session expired');
  return {sub:session.sub};
}
