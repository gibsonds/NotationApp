import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import { verifyAccessToken } from '../auth';
import * as auth from '../auth';
import { ddb } from '../ddb';
import { createSession, sessionCookie, sessionUser, assertBrowserRequest } from '../sessions';
import { readBody, identifier } from '../security';
import { revokeInvite, acceptInvite, removeMember } from '../songbook-repo';

beforeEach(()=> {vi.stubEnv('OAUTH_ISSUER','https://issuer.test');vi.stubEnv('OAUTH_AUDIENCE','charts');vi.stubEnv('APP_ORIGINS','https://charts.test');});
afterEach(()=> {vi.restoreAllMocks();vi.unstubAllEnvs();});

it('verifies signature, app audience, issuer, expiry and access-token claims',async()=> {
 const keys=await generateKeyPair('RS256'); const jwk=await exportJWK(keys.publicKey); const key=createLocalJWKSet({keys:[jwk]});
 const good={sub:'opaque-user',iss:'https://issuer.test',aud:'charts',exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000),jti:'token-1'};
 const mint=(payload:object)=>new SignJWT({...payload}).setProtectedHeader({alg:'RS256'}).sign(keys.privateKey);
 await expect(verifyAccessToken(await mint(good),key)).resolves.toMatchObject({payload:{sub:'opaque-user'}});
 for (const bad of [{...good,aud:'other-app'},{...good,iss:'https://evil.test'},{...good,exp:1},{...good,exp:undefined},{...good,jti:undefined},{...good,typ:'service_account'}]) {
   await expect(verifyAccessToken(await mint(bad),key)).rejects.toThrow();
 }
 vi.stubEnv('OAUTH_AUDIENCE',''); await expect(verifyAccessToken(await mint(good),key)).rejects.toThrow('not configured');
});

it('rejects cross-site cookie requests even when an origin resembles ours',()=> {
 const event=(origin:string,header='1')=>({headers:{origin,'x-notation-request':header}} as any);
 expect(()=>assertBrowserRequest(event('https://charts.test'))).not.toThrow();
 for(const origin of ['https://evil.test','https://charts.test.evil.test','null','']) expect(()=>assertBrowserRequest(event(origin))).toThrow();
 expect(()=>assertBrowserRequest(event('https://charts.test',''))).toThrow();
});

it('stores no OAuth tokens, email or profile in server sessions',async()=> {
 vi.spyOn(auth,'verifyAccessToken').mockResolvedValue({payload:{sub:'opaque-user',email:'private@example.test',name:'Private',exp:9999999999}} as any);
 const send=vi.spyOn(ddb,'send').mockResolvedValue({} as never);
 const created=await createSession({access_token:'oauth-secret',refresh_token:'refresh-secret',id_token:'id-secret'});
 const item=(send.mock.calls[0][0] as any).input.Item;
 expect(Object.keys(item).sort()).toEqual(['id','sub','ttl']);
 expect(JSON.stringify(item)).not.toMatch(/secret|private|Private/);
 const cookieId=created.cookie.split(';')[0].split('=')[1];
 expect(item.id).not.toEqual(cookieId);expect(created.cookie).toContain('Secure; HttpOnly; SameSite=Lax');
 expect(sessionCookie('',0)).toContain('Max-Age=0');
});
it('rejects expired server sessions even before DynamoDB TTL deletion',async()=> {
 vi.spyOn(ddb,'send').mockResolvedValue({Item:{sub:'u',ttl:1}} as never);
 await expect(sessionUser({headers:{},cookies:[`__Host-notation-session=${'a'.repeat(43)}`]} as any)).rejects.toThrow('expired');
});

it('rejects invalid JSON, excessive payloads and key-delimiter injection',()=> {
 for(const body of ['null','[]','oops']) expect(()=>readBody(body)).toThrow();
 expect(()=>readBody(JSON.stringify({title:'x'.repeat(340001)}))).toThrow('too large');
 expect(()=>identifier('song#V#123')).toThrow();
 expect(readBody(Buffer.from('{"title":"ok"}').toString('base64'),true)).toEqual({title:'ok'});
});

it('conditions global invite deletion on the authorized songbook',async()=> {
 const send=vi.spyOn(ddb,'send').mockRejectedValue(Object.assign(new Error('foreign book'),{name:'TransactionCanceledException'}));
 await expect(revokeInvite('my-book','foreign-invite')).resolves.toBeUndefined();
 const globalDelete=(send.mock.calls[0][0] as any).input.TransactItems[1].Delete;
 expect(globalDelete.ConditionExpression).toContain('songbookId = :book');
 expect(globalDelete.ExpressionAttributeValues[':book']).toBe('my-book');
});
it('consumes invites atomically with membership and prevents old-link rejoin',async()=> {
 const send=vi.spyOn(ddb,'send');
 const createdAt=Date.now();
 send.mockResolvedValueOnce({Item:{songbookId:'b',role:'viewer',createdAt,expiresAt:Date.now()+10000}} as never)
 .mockResolvedValueOnce({} as never).mockResolvedValueOnce({Item:{name:'Band'}} as never).mockResolvedValueOnce({} as never);
 await expect(acceptInvite('one-use','u')).resolves.toMatchObject({role:'viewer'});
 const tx=(send.mock.calls[3][0] as any).input.TransactItems;
 expect(tx[0].Delete.ConditionExpression).toContain('expiresAt > :now');
 expect(tx[2].ConditionCheck.Key.sk).toBe('REMOVED#u');
 expect(tx[2].ConditionCheck.ExpressionAttributeValues[':created']).toBe(createdAt);
 expect(tx[3].Put.ConditionExpression).toBe('attribute_not_exists(pk)');
 send.mockReset();send.mockResolvedValue({} as never);await removeMember('b','u');
 expect((send.mock.calls[0][0] as any).input.TransactItems[0].Put.Item.sk).toBe('REMOVED#u');
});
