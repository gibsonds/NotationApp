import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const mock=vi.hoisted(()=>({state:{status:'signed-in',claims:{sub:'r'},activeSongbookId:'a'},me:vi.fn()}));
vi.mock('@/lib/auth',()=>({getAccessToken:async()=>'synthetic',COOKIE_SESSIONS:false,browserRequestHeaders:()=>({}),getSnapshot:()=>mock.state,loadMe:mock.me}));
import {invitationToken,joinSongbook,acceptBookInvitation} from '../songbook-client';
beforeEach(()=>{mock.state={status:'signed-in',claims:{sub:'r'},activeSongbookId:'a'};mock.me.mockReset();});
afterEach(()=>{vi.unstubAllGlobals();});
it('accepts legacy links on their original route and requires review for multi-book links',async()=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json({songbookId:'legacy'}));vi.stubGlobal('fetch',fetcher);
 await expect(joinSongbook('https://charts.test/?invite=old-token')).resolves.toEqual({songbookId:'legacy'});expect(fetcher.mock.calls[0][0]).toContain('/invites/old-token/accept');
 await expect(joinSongbook('https://charts.test/?invite=mi-token')).rejects.toThrow('review all selected');expect(fetcher).toHaveBeenCalledOnce();expect(invitationToken('https://charts.test/?invite=mi-token')).toBe('mi-token');expect(()=>invitationToken('bad#token')).toThrow();
});
it('does not refresh a different session from a delayed acceptance response',async()=>{
 let resolve!:(r:Response)=>void;vi.stubGlobal('fetch',vi.fn().mockReturnValue(new Promise(r=>resolve=r)));
 const result=acceptBookInvitation('mi-token');await Promise.resolve();mock.state={...mock.state,claims:{sub:'other'}};resolve(Response.json({memberships:[{songbookId:'a'}]}));await expect(result).rejects.toThrow('session changed');expect(mock.me).not.toHaveBeenCalled();
});
it('surfaces a failed post-grant refresh, allowing a retry against the same receipt',async()=>{
 const fetcher=vi.fn().mockImplementation(async()=>Response.json({memberships:[{songbookId:'a'}]}));vi.stubGlobal('fetch',fetcher);mock.me.mockRejectedValueOnce(Error('refresh failed')).mockResolvedValueOnce([]);
 await expect(acceptBookInvitation('mi-token')).rejects.toThrow('refresh failed');await expect(acceptBookInvitation('mi-token')).resolves.toEqual([{songbookId:'a'}]);expect(fetcher.mock.calls.every(([u])=>u.endsWith('/invitations/mi-token/accept'))).toBe(true);
});
