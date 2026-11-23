import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { ddb } from '../ddb';
import { createMultiInvite, previewMultiInvite, acceptMultiInvite, claimInviteDelivery, markInviteSent } from '../multi-invites';
import { verifiedMailboxClaim } from '../verified-mailbox';
import { invitationMessage, sendInvitation, mailConfig } from '../invitation-mail';
import { createSession, sessionUser } from '../sessions';
import * as auth from '../auth';

// A deliberately small transaction simulator: validates every condition before
// applying ANY operation. Race tests alter state between consistent reads and commit.
type Row=Record<string,any>;
let rows:Map<string,Row>, beforeTransaction:(()=>void)|undefined;
const key=(r:Row)=>`${r.pk}|${r.sk}`;
const put=(r:Row)=>rows.set(key(r),structuredClone(r));
const get=(pk:string,sk:string)=>rows.get(key({pk,sk}));
function matches(row:Row|undefined,op:Row):boolean {
 const expr=op.ConditionExpression;
 if(!expr)return true;
 const v=op.ExpressionAttributeValues??{}, names=op.ExpressionAttributeNames??{};
 const clause=(s:string):boolean=>{
  s=s.trim();
  if(s==='attribute_not_exists(pk)')return !row;
  if(s==='attribute_exists(pk)')return !!row;
  if(s==='attribute_not_exists(acceptedBy)')return row?.acceptedBy===undefined;
  if(s==='attribute_not_exists(deliveryState)')return row?.deliveryState===undefined;
  const m=s.match(/^([#\w]+) (=|<|>) (:\w+)$/);if(!m)throw Error(`Unknown condition: ${s}`);
  const a=row?.[names[m[1]]??m[1]], b=v[m[3]];
  return a!==undefined&&(m[2]==='='?a===b:m[2]==='<'?a<b:a>b);
 };
 return expr.split(' OR ').some((part:string)=>part.split(' AND ').every(clause));
}
const selected=[{songbookId:'a',name:'TestBook',role:'viewer'},{songbookId:'b',name:'Synthetic band',role:'viewer'}];
const req='11111111-1111-4111-8111-111111111111';
const recipient={sub:'recipient'};
function member(book:string,sub:string,role:string){put({pk:`USER#${sub}`,sk:`MEMBER#${book}`,songbookId:book,role,addedAt:10});put({pk:`SONGBOOK#${book}`,sk:`MEMBER#${sub}`,sub,role,addedAt:10});}
beforeEach(()=>{
 rows=new Map();beforeTransaction=undefined;
 vi.stubEnv('VERIFIED_EMAIL_INVITES','1');
 for(const b of selected){put({pk:`SONGBOOK#${b.songbookId}`,sk:'META',name:b.name,createdAt:1});member(b.songbookId,'owner','owner');}
 vi.spyOn(ddb,'send').mockImplementation(async(command:any)=>{
  const input=command.input;
  if(input.Key && !input.UpdateExpression)return {Item:structuredClone(rows.get(key(input.Key)))} as any;
  if(!input.TransactItems)throw Error('Unexpected command');
  beforeTransaction?.();beforeTransaction=undefined;
  const ops=input.TransactItems.map((o:Row)=>o.Put??o.Update??o.ConditionCheck);
  expect(ops.length).toBeLessThanOrEqual(100);
  expect(new Set(ops.map((o:Row)=>key(o.Key??o.Item))).size).toBe(ops.length);
  if(ops.some((o:Row)=>!matches(rows.get(key(o.Key??o.Item)),o)))throw Object.assign(Error('cancel'),{name:'TransactionCanceledException'});
  for(const o of ops){if(o.Item)put(o.Item);else if(o.UpdateExpression){const row=rows.get(key(o.Key))!;const field=o.UpdateExpression.includes('acceptedBy')?'acceptedBy':'deliveryState';put({...row,[field]:o.ExpressionAttributeValues[field==='acceptedBy'?':sub':':state']});}}
  return {} as any;
 });
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
it('grants two selected books atomically, defaults to viewer and preserves an existing editor subset',async()=>{
 member('a','recipient','editor');const invite=await createMultiInvite('owner',selected,req);
 const preview=await previewMultiInvite(invite.token,recipient);expect(preview.allMember).toBe(false);expect(preview.books.map(b=>b.existingRole)).toEqual(['editor',null]);
 const result=await acceptMultiInvite(invite.token,recipient);expect(result.memberships.map(b=>b.role)).toEqual(['editor','viewer']);
 expect(get('USER#recipient','MEMBER#a')?.addedAt).toBe(10);expect(get('USER#recipient','MEMBER#b')?.role).toBe('viewer');
 const count=vi.mocked(ddb.send).mock.calls.filter(([c]:any)=>c.input.TransactItems).length;
 await expect(acceptMultiInvite(invite.token,recipient)).resolves.toEqual(result);
 expect(vi.mocked(ddb.send).mock.calls.filter(([c]:any)=>c.input.TransactItems)).toHaveLength(count);
 await expect(previewMultiInvite(invite.token,{sub:'other'})).rejects.toThrow('unavailable');
});
it('already-entitled members preview without grants or lost owner/editor rights',async()=>{
 member('a','recipient','owner');member('b','recipient','editor');const i=await createMultiInvite('owner',selected,req);
 expect((await previewMultiInvite(i.token,recipient)).allMember).toBe(true);
 expect(get('USER#recipient','MEMBER#a')?.role).toBe('owner');
});
it('binds targeted invitations to a verified mailbox before exposing names or accepting',async()=>{
 const i=await createMultiInvite('owner',selected,req,'jon@example.test');
 for(const u of [{sub:'r'},{sub:'r',email:'jon@example.test'},{sub:'r',verifiedEmail:'wrong@example.test'}]){
  await expect(previewMultiInvite(i.token,u)).rejects.toThrow('unavailable');await expect(acceptMultiInvite(i.token,u)).rejects.toThrow('unavailable');
 }
 expect((await previewMultiInvite(i.token,{sub:'r',verifiedEmail:'jon@EXAMPLE.test'})).books).toHaveLength(2);
 vi.stubEnv('VERIFIED_EMAIL_INVITES','0');await expect(acceptMultiInvite(i.token,{sub:'r',verifiedEmail:'jon@example.test'})).rejects.toThrow('unavailable');
});
it('rejects expiry and idempotent request reuse with a different selection',async()=>{
 const i=await createMultiInvite('owner',selected,req);expect((await createMultiInvite('owner',selected,req)).token).toBe(i.token);
 await expect(createMultiInvite('owner',selected.slice(0,1),req)).rejects.toThrow('different invitation');
 rows.get(key({pk:`MULTIINVITE#${i.token}`,sk:'META'}))!.expiresAt=1;
 await expect(acceptMultiInvite(i.token,recipient)).rejects.toThrow('expired');expect(get('USER#recipient','MEMBER#a')).toBeUndefined();
});
it.each(['owner','book','removed','membership-race'])('prevents all grants on atomic %s failure',async(kind)=>{
 const i=await createMultiInvite('owner',selected,req);
 beforeTransaction=()=>{
  if(kind==='owner')get('USER#owner','MEMBER#b')!.role='viewer';
  if(kind==='book')rows.delete('SONGBOOK#b|META');
  if(kind==='removed')put({pk:'SONGBOOK#b',sk:'REMOVED#recipient',removedAt:Date.now()+1});
  if(kind==='membership-race')member('b','recipient','editor');
 };
 await expect(acceptMultiInvite(i.token,recipient)).rejects.toThrow('No access was added');
 expect(get('USER#recipient','MEMBER#a')).toBeUndefined();expect(get(`MULTIINVITE#${i.token}`,'META')?.acceptedBy).toBeUndefined();
});
it('fails closed for changed preview names, missing books, lost owner, mirror mismatch and old links after removal',async()=>{
 await expect(createMultiInvite('owner',[{...selected[0],name:'Not this book'}],req)).rejects.toThrow('changed');
 const i=await createMultiInvite('owner',selected,req);get('SONGBOOK#b','META')!.name='Renamed';await expect(previewMultiInvite(i.token,recipient)).rejects.toThrow('changed');get('SONGBOOK#b','META')!.name=selected[1].name;
 member('a','recipient','viewer');get('SONGBOOK#a','MEMBER#recipient')!.role='editor';await expect(acceptMultiInvite(i.token,recipient)).rejects.toThrow('changed');get('SONGBOOK#a','MEMBER#recipient')!.role='viewer';
 await acceptMultiInvite(i.token,recipient);rows.delete('USER#recipient|MEMBER#a');rows.delete('SONGBOOK#a|MEMBER#recipient');await expect(acceptMultiInvite(i.token,recipient)).rejects.toThrow('changed');expect(get('USER#recipient','MEMBER#a')).toBeUndefined();
});
it('bounds and validates selections and refuses creator without every ownership grant',async()=>{
 for(const books of [[],Array(11).fill(selected[0]),[selected[0],selected[0]],[{...selected[0],role:'editor'}],[{...selected[0],songbookId:'a#META'}]])await expect(createMultiInvite('owner',books,req)).rejects.toThrow();
 get('USER#owner','MEMBER#b')!.role='viewer';await expect(createMultiInvite('owner',selected,req)).rejects.toThrow('changed');expect([...rows.keys()].some(k=>k.startsWith('MULTIINVITE#'))).toBe(false);
});
it('claims delivery once even on failure and escapes names in the one email',async()=>{
 const i=await createMultiInvite('owner',selected,req,'jon@example.test');expect(await claimInviteDelivery(i.token)).toBe(true);expect(await claimInviteDelivery(i.token)).toBe(false);
 const config={apiKey:'synthetic-key',sender:'owner@example.test',origin:'https://charts.test'};
 const fetcher=vi.fn().mockRejectedValue(Error('provider possibly accepted'));
 await expect(sendInvitation(config,i,fetcher)).rejects.toThrow('not be sent again');expect(await claimInviteDelivery(i.token)).toBe(false);
 const message=invitationMessage(config,{...i,books:[{...i.books[0],name:'<script>"&'}]});expect(message.htmlContent).not.toContain('<script>');expect(message.htmlContent).toContain('&lt;script&gt;');expect(message.textContent).toContain('choose Join once');
 await sendInvitation(config,i,vi.fn().mockResolvedValue(new Response('{}')));await markInviteSent(i.token);expect(get(`MULTIINVITE#${i.token}`,'META')?.deliveryState).toBe('sent');
 vi.stubEnv('BREVO_INVITE_SECRET_ID','');await expect(mailConfig()).rejects.toThrow('configured');
});
it('retains only strictly verified mailbox claims when explicitly enabled, never changes subject mapping or scope',async()=>{
 expect(verifiedMailboxClaim({email:'jon@EXAMPLE.test',email_verified:true})).toBe('jon@example.test');
 for(const p of [{email:'jon@example.test'},{email:'jon@example.test',email_verified:'true'},{email:'invalid',email_verified:true}])expect(verifiedMailboxClaim(p)).toBeUndefined();
 vi.stubEnv('VERIFIED_EMAIL_INVITES','0');expect(verifiedMailboxClaim({email:'jon@EXAMPLE.test',email_verified:true})).toBeUndefined();
});
it('ID-token session enrichment is default-off; injected verified claims work without OAuth login',async()=>{
 vi.spyOn(auth,'verifyIdToken').mockResolvedValue({payload:{sub:'opaque',email:'jon@EXAMPLE.test',email_verified:true}} as any);
 const send=vi.mocked(ddb.send);send.mockResolvedValue({} as never);
 vi.stubEnv('VERIFIED_EMAIL_INVITES','0');await createSession({id_token:'synthetic'},'n'.repeat(32));expect((send.mock.calls.at(-1)![0] as any).input.Item).not.toHaveProperty('verifiedEmail');
 vi.stubEnv('VERIFIED_EMAIL_INVITES','1');await createSession({id_token:'synthetic'},'n'.repeat(32));expect((send.mock.calls.at(-1)![0] as any).input.Item).toMatchObject({sub:'opaque',verifiedEmail:'jon@example.test'});
 send.mockResolvedValue({Item:{sub:'opaque',verifiedEmail:'jon@example.test',ttl:9999999999}} as never);
 expect(await sessionUser({headers:{},cookies:[`__Host-notation-session=${'a'.repeat(43)}`]} as any)).toEqual({sub:'opaque',verifiedEmail:'jon@example.test'});
 vi.stubEnv('VERIFIED_EMAIL_INVITES','0');expect(await sessionUser({headers:{},cookies:[`__Host-notation-session=${'a'.repeat(43)}`]} as any)).toEqual({sub:'opaque'});
});
it('supports the maximum ten-book selection within DynamoDB transaction limits',async()=>{
 const books=Array.from({length:10},(_,i)=>({songbookId:`max-${i}`,name:`Synthetic ${i}`,role:'viewer' as const}));
 for(const b of books){put({pk:`SONGBOOK#${b.songbookId}`,sk:'META',name:b.name,createdAt:1});member(b.songbookId,'owner','owner');}
 const invite=await createMultiInvite('owner',books,req);expect((await acceptMultiInvite(invite.token,recipient)).memberships).toHaveLength(10);
});
it('can accept as the creator without duplicate transaction operations and never reduces owner access',async()=>{
 const invite=await createMultiInvite('owner',selected,req);expect((await acceptMultiInvite(invite.token,{sub:'owner'})).memberships.every(m=>m.role==='owner')).toBe(true);
});
