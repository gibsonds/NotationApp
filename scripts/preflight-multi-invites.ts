/** Runs only against an explicitly supplied loopback DynamoDB Local endpoint.
 * No cloud credential or live table is used. Creates/deletes its own random table. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DynamoDBClient,CreateTableCommand,DeleteTableCommand} from '../infra/node_modules/@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,PutCommand,GetCommand,UpdateCommand,DeleteCommand} from '../infra/node_modules/@aws-sdk/lib-dynamodb';
async function main(){
 const endpoint=new URL(process.env.DDB_ENDPOINT??'');
 if(endpoint.hostname!=='127.0.0.1'||endpoint.protocol!=='http:'||endpoint.username||endpoint.password)throw Error('Set DDB_ENDPOINT to an explicit http://127.0.0.1:<port> DynamoDB Local endpoint.');
 process.env.TABLE_NAME=`SyntheticInvitation-${randomUUID()}`;
 process.env.AWS_ACCESS_KEY_ID='synthetic';process.env.AWS_SECRET_ACCESS_KEY='synthetic';process.env.AWS_EC2_METADATA_DISABLED='true';process.env.VERIFIED_EMAIL_INVITES='1';
 const raw=new DynamoDBClient({endpoint:endpoint.toString(),region:'us-east-1',credentials:{accessKeyId:'synthetic',secretAccessKey:'synthetic'}});
 const db=DynamoDBDocumentClient.from(raw),table=process.env.TABLE_NAME;
 await raw.send(new CreateTableCommand({TableName:table,KeySchema:[{AttributeName:'pk',KeyType:'HASH'},{AttributeName:'sk',KeyType:'RANGE'}],AttributeDefinitions:[{AttributeName:'pk',AttributeType:'S'},{AttributeName:'sk',AttributeType:'S'}],BillingMode:'PAY_PER_REQUEST'}));
 try {
  const engine=await import('../infra/lambda/multi-invites');
  const books=[{songbookId:'a',name:'Synthetic TestBook',role:'viewer' as const},{songbookId:'b',name:'Synthetic Band',role:'viewer' as const}];
  const put=async(Item:object)=>db.send(new PutCommand({TableName:table,Item}));
  const read=async(pk:string,sk:string)=>(await db.send(new GetCommand({TableName:table,Key:{pk,sk},ConsistentRead:true}))).Item;
  const member=async(id:string,sub:string,role:string)=>{await put({pk:`USER#${sub}`,sk:`MEMBER#${id}`,songbookId:id,role,addedAt:1});await put({pk:`SONGBOOK#${id}`,sk:`MEMBER#${sub}`,sub,role,addedAt:1});};
  for(const b of books){await put({pk:`SONGBOOK#${b.songbookId}`,sk:'META',name:b.name,createdAt:1});await member(b.songbookId,'owner','owner');}
  await member('a','recipient','editor');
  const invite=await engine.createMultiInvite('owner',books,randomUUID(),'tester@example.test');
  await assert.rejects(engine.previewMultiInvite(invite.token,{sub:'wrong',verifiedEmail:'wrong@example.test'}));
  const user={sub:'recipient',verifiedEmail:'tester@example.test'};
  assert.equal((await engine.previewMultiInvite(invite.token,user)).allMember,false);
  const joined=await engine.acceptMultiInvite(invite.token,user);assert.deepEqual(joined.memberships.map(b=>b.role),['editor','viewer']);
  assert.deepEqual(await engine.acceptMultiInvite(invite.token,user),joined);
  assert.equal(await engine.claimInviteDelivery(invite.token),true);assert.equal(await engine.claimInviteDelivery(invite.token),false);await engine.markInviteSent(invite.token);
  const owner=await engine.createMultiInvite('owner',books,randomUUID());assert.equal((await engine.acceptMultiInvite(owner.token,{sub:'owner'})).memberships.every(b=>b.role==='owner'),true);
  // Real-engine checks for new Editor grants, not only preservation of an
  // already-Editor membership. Each token still binds to its own recipient.
  for (const [label,roles] of [['mixed',['editor','viewer']],['editors',['editor','editor']]] as const) {
   const selected=books.map((b,i)=>({...b,role:roles[i]}));
   const grant=await engine.createMultiInvite('owner',selected,randomUUID());
   const result=await engine.acceptMultiInvite(grant.token,{sub:label});
   assert.deepEqual(result.memberships.map(b=>b.role),[...roles]);
   for(const [i,b] of selected.entries()) {
    assert.equal((await read(`USER#${label}`,`MEMBER#${b.songbookId}`))?.role,roles[i]);
    assert.equal((await read(`SONGBOOK#${b.songbookId}`,`MEMBER#${label}`))?.role,roles[i]);
   }
   assert.deepEqual(await engine.acceptMultiInvite(grant.token,{sub:label}),result);
  }
  await member('a','existing-viewer','viewer');
  const offered=await engine.createMultiInvite('owner',books.map(b=>({...b,role:'editor' as const})),randomUUID());
  assert.equal((await engine.previewMultiInvite(offered.token,{sub:'existing-viewer'})).books[0].effectiveRole,'viewer');
  assert.deepEqual((await engine.acceptMultiInvite(offered.token,{sub:'existing-viewer'})).memberships.map(b=>b.role),['viewer','editor']);
  // The removal tombstone is checked inside the transaction: even the first
  // book's planned membership must remain absent when the second check fails.
  const blocked=await engine.createMultiInvite('owner',books,randomUUID());
  await put({pk:'SONGBOOK#b',sk:'REMOVED#blocked',removedAt:blocked.createdAt+1});
  await assert.rejects(engine.acceptMultiInvite(blocked.token,{sub:'blocked'}));
  assert.equal(await read('USER#blocked','MEMBER#a'),undefined);assert.equal(await read('USER#blocked','MEMBER#b'),undefined);
  assert.equal((await read(`MULTIINVITE#${blocked.token}`,'META'))?.acceptedBy,undefined);
  const expired=await engine.createMultiInvite('owner',books,randomUUID());
  await db.send(new UpdateCommand({TableName:table,Key:{pk:`MULTIINVITE#${expired.token}`,sk:'META'},UpdateExpression:'SET expiresAt = :expired',ExpressionAttributeValues:{':expired':1}}));
  await assert.rejects(engine.acceptMultiInvite(expired.token,{sub:'expired'}));
  const failing=await engine.createMultiInvite('owner',books,randomUUID());
  await db.send(new UpdateCommand({TableName:table,Key:{pk:'USER#owner',sk:'MEMBER#b'},UpdateExpression:'SET #r = :r',ExpressionAttributeNames:{'#r':'role'},ExpressionAttributeValues:{':r':'viewer'}}));
  await assert.rejects(engine.acceptMultiInvite(failing.token,{sub:'new-user'}));assert.equal(await read('USER#new-user','MEMBER#a'),undefined);assert.equal(await read('USER#new-user','MEMBER#b'),undefined);
  await db.send(new DeleteCommand({TableName:table,Key:{pk:'USER#recipient',sk:'MEMBER#a'}}));await db.send(new DeleteCommand({TableName:table,Key:{pk:'SONGBOOK#a',sk:'MEMBER#recipient'}}));
  await assert.rejects(engine.acceptMultiInvite(invite.token,user));assert.equal(await read('USER#recipient','MEMBER#a'),undefined);
  console.log('DynamoDB Local passed: actual transaction expressions, new mixed and all-Editor grants/mirrors, existing Viewer preservation, wrong mailbox, expiry, receipt retry, delivery claim, creator acceptance and all-or-none transaction failure.');
 } finally {await raw.send(new DeleteTableCommand({TableName:table}));raw.destroy();}
}
void main().catch((err:unknown)=>{const e=err as {name?:string;message?:string};console.error('Synthetic local invitation preflight failed; no cloud endpoint was used.',e.name,e.message?.replace(/mi-[a-f0-9-]+/g,'[redacted]').replace(/[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+/g,'[mailbox]'));process.exitCode=1;});
