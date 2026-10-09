import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE } from './ddb';

export class RequestError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}
export const MAX_BODY_BYTES = 340_000;
export function readBody(body?: string, base64 = false): Record<string, unknown> {
  const text = base64 ? Buffer.from(body ?? '', 'base64').toString('utf8') : body ?? '{}';
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new RequestError(413, 'Request is too large (340 KB maximum).');
  let result: unknown;
  try { result = JSON.parse(text); } catch { throw new RequestError(400, 'Invalid JSON.'); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new RequestError(400, 'JSON object required.');
  return result as Record<string, unknown>;
}
export function identifier(value: string | undefined): string {
  if (!value || value.length > 200 || !/^[a-zA-Z0-9_.:@-]+$/.test(value)) throw new RequestError(400, 'Invalid identifier.');
  return value;
}
/** Atomic, bounded per-user operations. TTL only cleans records; the key enforces the window. */
export async function limitOperation(subject: string, operation: string, limit: number, seconds: number) {
  const window = Math.floor(Date.now() / 1000 / seconds);
  await consumeLimit(`LIMIT#${subject}`, `${operation}#${window}`, limit, (window + 2) * seconds);
}
export async function consumeLimit(pk: string, sk: string, limit: number, expiresAt?: number) {
  try {
    await ddb.send(new UpdateCommand({ TableName: TABLE, Key: { pk, sk },
      UpdateExpression: 'ADD #count :one' + (expiresAt ? ' SET ttl = :ttl' : ''),
      ConditionExpression: 'attribute_not_exists(#count) OR #count < :max',
      ExpressionAttributeNames: { '#count': 'count' },
      ExpressionAttributeValues: { ':one': 1, ':max': limit, ...(expiresAt ? { ':ttl': expiresAt } : {}) },
    }));
  } catch (err) {
    if ((err as Error).name === 'ConditionalCheckFailedException') throw new RequestError(429, 'Limit reached. Please try later or contact the owner.');
    throw err;
  }
}
