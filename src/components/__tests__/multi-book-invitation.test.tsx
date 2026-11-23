import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach,afterEach,expect,it,vi } from 'vitest';
const mock=vi.hoisted(()=>({state:{status:'signed-in',claims:{sub:'owner'},activeSongbookId:'a',memberships:[{songbookId:'a',name:'TestBook',role:'owner'},{songbookId:'b',name:'Synthetic band',role:'owner'},{songbookId:'private',name:'Personal unshared',role:'owner'}]},listeners:new Set<()=>void>(),create:vi.fn(),preview:vi.fn(),accept:vi.fn(),begin:vi.fn(),open:vi.fn(),out:vi.fn()}));
vi.mock('@/lib/auth',()=>({getSnapshot:()=>mock.state,subscribe:(fn:()=>void)=>{mock.listeners.add(fn);return()=>mock.listeners.delete(fn);},beginSignIn:mock.begin,setActiveSongbook:mock.open,signOut:mock.out}));
vi.mock('@/lib/songbook-client',()=>({createBookInvitation:mock.create,invitationCapabilities:async()=>({emailDelivery:true}),previewInvitation:mock.preview,acceptBookInvitation:mock.accept}));
import Composer from '../MultiBookInviteComposer';
import Flow from '../MultiBookInviteFlow';
let host:HTMLDivElement,root:ReturnType<typeof createRoot>;
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host);mock.state={status:'signed-in',claims:{sub:'owner'},activeSongbookId:'a',memberships:[{songbookId:'a',name:'TestBook',role:'owner'},{songbookId:'b',name:'Synthetic band',role:'owner'},{songbookId:'private',name:'Personal unshared',role:'owner'}]};mock.preview.mockReset();mock.create.mockReset();mock.accept.mockReset();mock.begin.mockReset();mock.open.mockReset();mock.out.mockReset();});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const button=(text:string)=>[...host.querySelectorAll('button')].find(b=>b.textContent===text)!;
it('previews exactly selected names/viewer roles before one issuance; omitted personal book is absent',async()=>{
 mock.create.mockResolvedValue({token:'mi-demo',delivery:'sent'});
 await act(async()=>root.render(<Composer onClose={()=>{}}/>));
 const checks=host.querySelectorAll<HTMLInputElement>('input[type=checkbox]');await act(async()=>{checks[0].click();checks[1].click();});
 const email=host.querySelector<HTMLInputElement>('input[type=email]')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(email,'jon@example.test');email.dispatchEvent(new Event('input',{bubbles:true}));email.dispatchEvent(new Event('change',{bubbles:true}));});
 await act(async()=>button('Review selected books').click());expect(mock.create).not.toHaveBeenCalled();expect(host.textContent).not.toContain('Personal unshared');expect(host.textContent).toContain('TestBook');
 // Empty email is also a supported private-link path in browsers with synthetic events.
 await act(async()=>host.querySelector<HTMLButtonElement>('button[type=submit]')!.click());
 expect(mock.create).toHaveBeenCalledOnce();expect(mock.create.mock.calls[0][0]).toEqual([{songbookId:'a',name:'TestBook',role:'viewer'},{songbookId:'b',name:'Synthetic band',role:'viewer'}]);
 expect(host.textContent).toContain('One invitation email was sent.');
});
it('retries the same request ID after an issuance error instead of issuing duplicates',async()=>{
 mock.create.mockRejectedValueOnce(Error('temporary')).mockResolvedValueOnce({token:'mi-demo',delivery:'unconfirmed'});
 await act(async()=>root.render(<Composer onClose={()=>{}}/>));await act(async()=>host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());await act(async()=>button('Review selected books').click());await act(async()=>button('Create private link').click());expect(host.textContent).toContain('temporary');await act(async()=>button('Create private link').click());expect(mock.create.mock.calls[0][1]).toBe(mock.create.mock.calls[1][1]);expect(host.textContent).toContain('not be resent automatically');
});
it('requires explicit Join once for new/subset members and preserves existing access wording',async()=>{
 const books=[{songbookId:'a',name:'TestBook',role:'viewer',existingRole:'editor'},{songbookId:'b',name:'Synthetic band',role:'viewer',existingRole:null}];
 mock.preview.mockResolvedValue({books,allMember:false});mock.accept.mockImplementation(async()=>{mock.state={...mock.state,memberships:[...mock.state.memberships]};return books;});const leave=vi.fn();
 await act(async()=>root.render(<Flow token="mi-test" ready signedIn onLeave={leave}/>));expect(mock.accept).not.toHaveBeenCalled();expect(host.textContent).toContain('editor access stays unchanged');await act(async()=>button('Join selected songbooks').click());expect(mock.accept).toHaveBeenCalledOnce();expect(leave).toHaveBeenCalledOnce();expect(mock.open).toHaveBeenCalledWith('a');
});
it('opens an all-member invitation without redundant acceptance',async()=>{
 mock.preview.mockResolvedValue({books:[{songbookId:'a',name:'TestBook',role:'viewer',existingRole:'owner'}],allMember:true});const leave=vi.fn();await act(async()=>root.render(<Flow token="mi-test" ready signedIn onLeave={leave}/>));expect(mock.accept).not.toHaveBeenCalled();expect(leave).toHaveBeenCalledOnce();expect(mock.open).toHaveBeenCalledWith('a');
});
it('wrong recipient sees no names and cannot Join; switching accounts does not reuse a delayed preview',async()=>{
 let resolve!:(v:any)=>void;mock.preview.mockReturnValueOnce(new Promise(r=>resolve=r));
 await act(async()=>root.render(<Flow token="mi-test" ready signedIn onLeave={()=>{}}/>));
 await act(async()=>{mock.state={...mock.state,claims:{sub:'wrong'}};mock.preview.mockRejectedValue(Error('Invitation unavailable'));mock.listeners.forEach(fn=>fn());});
 await act(async()=>resolve({books:[{songbookId:'secret',name:'Must never appear'}],allMember:false}));expect(host.textContent).not.toContain('Must never appear');expect(button('Join selected songbooks').disabled).toBe(true);expect(mock.accept).not.toHaveBeenCalled();
});
it('new-user flow uses one neutral sign-in entry and preserves the invitation until explicit Join',async()=>{
 await act(async()=>root.render(<Flow token="mi-test" ready signedIn={false} onLeave={()=>{}}/>));expect(host.textContent).toContain('account creation option');await act(async()=>button('Continue to sign in').click());expect(mock.begin).toHaveBeenCalledOnce();expect(mock.accept).not.toHaveBeenCalled();
});
it('retains the invitation after a post-grant refresh failure so an idempotent retry can finish',async()=>{
 mock.preview.mockResolvedValue({books:[{songbookId:'a',name:'TestBook',role:'viewer',existingRole:null}],allMember:false});mock.accept.mockRejectedValueOnce(Error('Refresh failed')).mockResolvedValueOnce([{songbookId:'a'}]);const leave=vi.fn();
 await act(async()=>root.render(<Flow token="mi-test" ready signedIn onLeave={leave}/>));await act(async()=>button('Join selected songbooks').click());expect(host.textContent).toContain('Refresh failed');expect(leave).not.toHaveBeenCalled();await act(async()=>button('Join selected songbooks').click());expect(leave).toHaveBeenCalledOnce();expect(mock.accept).toHaveBeenCalledTimes(2);
});
