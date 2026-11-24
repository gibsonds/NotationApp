import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createMultiInvite,previewMultiInvite,acceptMultiInvite,claimInviteDelivery,markInviteSent} from '../../infra/lambda/multi-invites';
import {sendInvitation,invitationMessage} from '../../infra/lambda/invitation-mail';
import {rows,put} from './store';
const port=Number(process.env.PREVIEW_PORT??4319),origin=`http://127.0.0.1:${port}`;
let outbox:any[]=[];
const names=[['a','TestBook'],['b','Synthetic Collision Storm'],['c','Synthetic JonSaxon'],['private','Personal — do not share']];
function member(book:string,sub:string,role:string){put({pk:`USER#${sub}`,sk:`MEMBER#${book}`,songbookId:book,name:names.find(b=>b[0]===book)![1],role,addedAt:1});put({pk:`SONGBOOK#${book}`,sk:`MEMBER#${sub}`,sub,role,addedAt:1});}
function reset(){rows.clear();outbox=[];for(const[id,name]of names){put({pk:`SONGBOOK#${id}`,sk:'META',name,createdAt:1});member(id,'owner','owner');if(id!=='private')member(id,'member','viewer');}member('a','recipient','editor');}reset();
process.env.VERIFIED_EMAIL_INVITES='1';
const server=createServer(async(req,res)=>{
 const url=new URL(req.url??'/',origin);res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer');
 const reply=(code:number,value:unknown)=>{res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 if(req.headers.host!==`127.0.0.1:${port}`||(req.headers.origin&&req.headers.origin!==origin)||req.headers['sec-fetch-site']==='cross-site')return reply(403,{error:'Local preview only'});
 try{
  if(url.pathname==='/'||url.pathname==='/app.js'||url.pathname==='/style.css'){const file=url.pathname==='/'?'index.html':url.pathname.slice(1);res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');return res.end(await readFile(`${process.env.PREVIEW_BUILD}/${file}`));}
  if(url.pathname==='/preview/reset'&&req.method==='POST'){reset();return reply(200,{ok:true});}
  if(url.pathname==='/preview/outbox')return reply(200,outbox);
  const sub=req.headers.authorization?.replace(/^Bearer /,'').replace(/^preview-/,'');if(!sub||!['owner','recipient','member','new-user','wrong','signed-out'].includes(sub))return reply(401,{});
  const user={sub,...(['recipient','member','new-user'].includes(sub)?{verifiedEmail:'tester@example.test'}:{verifiedEmail:'other@example.test'})};
  if(url.pathname==='/api/me')return reply(200,{sub,memberships:[...rows.values()].filter(r=>r.pk===`USER#${sub}`&&r.sk.startsWith('MEMBER#'))});
  if(url.pathname==='/api/invitations/capabilities')return reply(200,{emailDelivery:true});
  const match=url.pathname.match(/^\/api\/invitations\/([\w-]+)(\/accept)?$/);
  if(match){if(sub==='signed-out')return reply(401,{});return reply(200,match[2]?await acceptMultiInvite(match[1],user):await previewMultiInvite(match[1],user));}
  if(url.pathname==='/api/invitations'&&req.method==='POST'){
   let body='';for await(const chunk of req){body+=chunk;if(body.length>10000)throw Error('Too large');}const b=JSON.parse(body);
   const invite=await createMultiInvite(sub,b.books,b.requestId,b.recipientEmail);
   let delivery=invite.deliveryState==='sent'?'sent':invite.deliveryState?'unconfirmed':'link';
   if(invite.recipientEmail&&await claimInviteDelivery(invite.token)){
    // Explicitly injected fake transport: there is NO network send in this harness.
    const config={apiKey:'mock',sender:'owner@example.test',origin};
    await sendInvitation(config,invite,async()=>new Response('{}'));
    outbox.push({to:invite.recipientEmail,token:invite.token,message:invitationMessage(config,invite)});await markInviteSent(invite.token);delivery='sent';
   }
   return reply(200,{token:invite.token,expiresAt:invite.expiresAt,delivery});
  }
  reply(404,{});
 }catch(e){const err=e as {statusCode?:number;message?:string};reply(err.statusCode??500,{error:err.statusCode?err.message:'Synthetic preview error'});}
});
server.listen(port,'127.0.0.1',()=>console.log(`Synthetic invitation preview: ${origin}`));
