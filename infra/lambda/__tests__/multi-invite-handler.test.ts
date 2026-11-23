import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {handler} from '../handler-auth';
import * as auth from '../auth';
import * as security from '../security';
import * as repo from '../multi-invites';
import * as mail from '../invitation-mail';
const invite={token:'mi-synthetic',createdBy:'owner',createdAt:1,expiresAt:9999999999999,recipientEmail:'tester@example.test',books:[{songbookId:'a',name:'TestBook',role:'viewer' as const,createdAt:1}]};
const event=(body:object={},route='POST /invitations')=>({routeKey:route,headers:{},body:JSON.stringify(body),pathParameters:{token:'mi-synthetic'}} as any);
beforeEach(()=>{vi.stubEnv('MULTI_BOOK_INVITES','1');vi.stubEnv('COOKIE_SESSIONS','0');vi.spyOn(auth,'requireUser').mockResolvedValue({sub:'owner'});vi.spyOn(security,'limitOperation').mockResolvedValue();});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
it('is default-off independently of frontend flags and never issues when disabled',async()=>{
 vi.stubEnv('MULTI_BOOK_INVITES','');const create=vi.spyOn(repo,'createMultiInvite');expect((await handler(event()) as any).statusCode).toBe(404);expect(create).not.toHaveBeenCalled();
});
it('validates email configuration before any invitation or transport side effect',async()=>{
 const config=vi.spyOn(mail,'mailConfig').mockRejectedValue(new security.RequestError(503,'not configured'));const create=vi.spyOn(repo,'createMultiInvite');const send=vi.spyOn(mail,'sendInvitation');expect((await handler(event({recipientEmail:'tester@example.test'})) as any).statusCode).toBe(503);expect(config).toHaveBeenCalledOnce();expect(create).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
});
it('returns an unconfirmed delivery after an ambiguous failure and never retries a claimed send',async()=>{
 vi.spyOn(mail,'mailConfig').mockResolvedValue({apiKey:'mock',sender:'sender@example.test',origin:'https://charts.test'});
 vi.spyOn(repo,'createMultiInvite').mockResolvedValue(invite);const claim=vi.spyOn(repo,'claimInviteDelivery').mockResolvedValueOnce(true).mockResolvedValueOnce(false);const send=vi.spyOn(mail,'sendInvitation').mockRejectedValue(Error('private provider details'));
 const body={books:invite.books,recipientEmail:'tester@example.test',requestId:'11111111-1111-4111-8111-111111111111'};
 for(let i=0;i<2;i++){const r=await handler(event(body)) as any;expect(r.statusCode).toBe(200);expect(JSON.parse(r.body).delivery).toBe('unconfirmed');expect(r.body).not.toContain('private provider details');}
 expect(claim).toHaveBeenCalledTimes(2);expect(send).toHaveBeenCalledOnce();
});
it('does not accept a client identity override or leak mailbox binding in the response',async()=>{
 const accept=vi.spyOn(repo,'acceptMultiInvite').mockResolvedValue({memberships:[]});await handler(event({sub:'victim',verifiedEmail:'tester@example.test'},'POST /invitations/{token}/accept'));expect(accept).toHaveBeenCalledWith('mi-synthetic',{sub:'owner'});
});
