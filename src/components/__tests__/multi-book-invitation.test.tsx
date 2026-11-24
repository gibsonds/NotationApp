import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach,afterEach,expect,it,vi } from 'vitest';
const mock=vi.hoisted(()=>({state:{status:'signed-in',claims:{sub:'owner'},activeSongbookId:'a',memberships:[{songbookId:'a',name:'TestBook',role:'owner'},{songbookId:'b',name:'Synthetic band',role:'owner'},{songbookId:'private',name:'Personal unshared',role:'owner'}]},listeners:new Set<()=>void>(),create:vi.fn(),preview:vi.fn(),accept:vi.fn(),begin:vi.fn(),open:vi.fn(),out:vi.fn(),me:vi.fn(),capabilities:vi.fn()}));
vi.mock('@/lib/auth',()=>({getSnapshot:()=>mock.state,subscribe:(fn:()=>void)=>{mock.listeners.add(fn);return()=>mock.listeners.delete(fn);},beginSignIn:mock.begin,setActiveSongbook:mock.open,signOut:mock.out,loadMe:mock.me}));
vi.mock('@/lib/songbook-client',()=>({createBookInvitation:mock.create,invitationCapabilities:mock.capabilities,previewInvitation:mock.preview,acceptBookInvitation:mock.accept}));
import Composer from '../MultiBookInviteComposer';
import Flow from '../MultiBookInviteFlow';
const clipboardDescriptor=Object.getOwnPropertyDescriptor(navigator,'clipboard');
let host:HTMLDivElement,root:ReturnType<typeof createRoot>;
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host);mock.state={status:'signed-in',claims:{sub:'owner'},activeSongbookId:'a',memberships:[{songbookId:'a',name:'TestBook',role:'owner'},{songbookId:'b',name:'Synthetic band',role:'owner'},{songbookId:'private',name:'Personal unshared',role:'owner'}]};mock.capabilities.mockReset();mock.capabilities.mockResolvedValue({emailDelivery:true});mock.preview.mockReset();mock.create.mockReset();mock.accept.mockReset();mock.begin.mockReset();mock.open.mockReset();mock.out.mockReset();mock.me.mockReset();mock.me.mockImplementation(async()=>mock.state.memberships);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();if(clipboardDescriptor)Object.defineProperty(navigator,'clipboard',clipboardDescriptor);else Reflect.deleteProperty(navigator,'clipboard');vi.unstubAllGlobals();});
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
 mock.preview.mockResolvedValue({books:[{songbookId:'a',name:'TestBook',role:'viewer',existingRole:'viewer'}],allMember:true});const leave=vi.fn();await act(async()=>root.render(<Flow token="mi-test" ready signedIn onLeave={leave}/>));expect(mock.accept).not.toHaveBeenCalled();expect(leave).toHaveBeenCalledOnce();expect(mock.open).toHaveBeenCalledWith('a');
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
it('defaults each selected book to Viewer and freezes independent Editor/Viewer roles before issuance',async()=>{
 mock.create.mockResolvedValue({token:'mi-demo',delivery:'link'});
 await act(async()=>root.render(<Composer onClose={()=>{}}/>));
 const checks=host.querySelectorAll<HTMLInputElement>('input[type=checkbox]');await act(async()=>{checks[0].click();checks[1].click();});
 const editor=host.querySelector<HTMLSelectElement>('select[aria-label="Access for TestBook"]')!;const viewer=host.querySelector<HTMLSelectElement>('select[aria-label="Access for Synthetic band"]')!;
 expect(editor.value).toBe('viewer');expect(viewer.value).toBe('viewer');
 await act(async()=>{editor.value='editor';editor.dispatchEvent(new Event('change',{bubbles:true}));});expect(viewer.value).toBe('viewer');
 await act(async()=>button('Review selected books').click());expect(host.textContent).toContain('Editor for new members');expect(host.textContent).toContain('Viewer for new members');expect(host.textContent).toContain('never upgraded or downgraded');expect(mock.create).not.toHaveBeenCalled();
 await act(async()=>button('Create private link').click());expect(mock.create.mock.calls[0][0]).toEqual([{songbookId:'a',name:'TestBook',role:'editor'},{songbookId:'b',name:'Synthetic band',role:'viewer'}]);
});
it('clearly distinguishes an existing Viewer from the offered Editor role before joining other books',async()=>{
 mock.preview.mockResolvedValue({books:[{songbookId:'a',name:'TestBook',role:'editor',existingRole:'viewer',effectiveRole:'viewer'},{songbookId:'b',name:'Synthetic band',role:'viewer',existingRole:null,effectiveRole:'viewer'}],allMember:false});
 await act(async()=>root.render(<Flow token="mi-test" ready signedIn onLeave={()=>{}}/>));expect(host.textContent).toContain('viewer access stays unchanged');expect(host.textContent).toContain('Invitation offers editor for new members. Your actual viewer access will not change.');expect(mock.accept).not.toHaveBeenCalled();
});
it('shows a role mismatch even for an all-member visitor, then opens without an implicit upgrade or acceptance',async()=>{
 mock.state.memberships=[{songbookId:'a',name:'TestBook',role:'viewer'}];mock.preview.mockResolvedValue({books:[{songbookId:'a',name:'TestBook',role:'editor',existingRole:'viewer',effectiveRole:'viewer'}],allMember:true});const leave=vi.fn();
 await act(async()=>root.render(<Flow token="mi-test" ready signedIn onLeave={leave}/>));expect(leave).not.toHaveBeenCalled();expect(host.textContent).toContain('Your actual viewer access will not change.');
 await act(async()=>button('Open existing songbooks').click());expect(mock.accept).not.toHaveBeenCalled();expect(mock.me).toHaveBeenCalledOnce();expect(leave).toHaveBeenCalledOnce();expect(mock.open).toHaveBeenCalledWith('a');expect(mock.state.memberships[0].role).toBe('viewer');
});
it('reselecting a book resets its role to Viewer instead of retaining an earlier Editor choice',async()=>{
 await act(async()=>root.render(<Composer onClose={()=>{}}/>));const check=host.querySelector<HTMLInputElement>('input[type=checkbox]')!;await act(async()=>check.click());const role=host.querySelector<HTMLSelectElement>('select[aria-label="Access for TestBook"]')!;await act(async()=>{role.value='editor';role.dispatchEvent(new Event('change',{bubbles:true}));});await act(async()=>check.click());await act(async()=>check.click());expect(role.value).toBe('viewer');
});

it('makes private-link sharing available when automatic email is disconnected and copies only on request',async()=>{
 mock.capabilities.mockResolvedValue({emailDelivery:false});mock.create.mockResolvedValue({token:'mi-synthetic-copy',delivery:'link'});
 const writeText=vi.fn().mockResolvedValue(undefined);Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}});
 await act(async()=>root.render(<Composer onClose={()=>{}}/>));expect(host.textContent).toContain('Automatic email is not connected.');expect(host.textContent).toContain('Create a private link');
 expect(host.querySelector<HTMLInputElement>('input[type=email]')!.disabled).toBe(true);expect(button('Copy link')).toBeUndefined();
 await act(async()=>host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());await act(async()=>button('Review selected books').click());await act(async()=>button('Create private link').click());
 const link=host.querySelector<HTMLInputElement>('input[aria-label="Invitation link"]')!;expect(link.value).toContain('invite=mi-synthetic-copy');expect(writeText).not.toHaveBeenCalled();expect(mock.create).toHaveBeenCalledOnce();
 await act(async()=>button('Copy link').click());expect(writeText).toHaveBeenCalledExactlyOnceWith(link.value);expect(button('Copied')).toBeDefined();expect(host.textContent).toContain('Link copied.');expect(button('Done')).toBeDefined();expect(mock.create).toHaveBeenCalledOnce();expect(mock.accept).not.toHaveBeenCalled();
 // Submitting from the readonly link must not issue another invitation.
 await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(mock.create).toHaveBeenCalledOnce();
});
it('honestly falls back to manual link selection when clipboard access is rejected',async()=>{
 mock.capabilities.mockResolvedValue({emailDelivery:false});mock.create.mockResolvedValue({token:'mi-synthetic-fallback',delivery:'link'});
 const writeText=vi.fn().mockRejectedValue(Error('synthetic private diagnostic'));Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}});
 await act(async()=>root.render(<Composer onClose={()=>{}}/>));await act(async()=>host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());await act(async()=>button('Review selected books').click());await act(async()=>button('Create private link').click());await act(async()=>button('Copy link').click());
 const link=host.querySelector<HTMLInputElement>('input[aria-label="Invitation link"]')!;expect(document.activeElement).toBe(link);expect(link.selectionStart).toBe(0);expect(link.selectionEnd).toBe(link.value.length);expect(host.textContent).toContain('Copy wasn’t available. The link is selected');expect(host.textContent).not.toContain('synthetic private diagnostic');expect(host.textContent).not.toContain('Link copied.');expect(button('Copy link')).toBeDefined();expect(mock.create).toHaveBeenCalledOnce();expect(mock.accept).not.toHaveBeenCalled();
});
it('waits for clipboard confirmation before reporting success',async()=>{
 mock.create.mockResolvedValue({token:'mi-synthetic-pending',delivery:'link'});let finish!:()=>void;
 const writeText=vi.fn().mockReturnValue(new Promise<void>(resolve=>{finish=resolve;}));Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}});
 await act(async()=>root.render(<Composer onClose={()=>{}}/>));await act(async()=>host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());await act(async()=>button('Review selected books').click());await act(async()=>button('Create private link').click());await act(async()=>button('Copy link').click());
 expect(button('Copying…').disabled).toBe(true);expect(host.textContent).not.toContain('Link copied.');expect(writeText).toHaveBeenCalledOnce();await act(async()=>finish());expect(host.textContent).toContain('Link copied.');expect(mock.create).toHaveBeenCalledOnce();
});
it('closes and refuses to copy a result after the signed-in actor changes',async()=>{
 mock.create.mockResolvedValue({token:'mi-synthetic-stale',delivery:'link'});const writeText=vi.fn();Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}});const close=vi.fn();
 await act(async()=>root.render(<Composer onClose={close}/>));await act(async()=>host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());await act(async()=>button('Review selected books').click());await act(async()=>button('Create private link').click());
 await act(async()=>{mock.state={...mock.state,claims:{sub:'another-actor'}};mock.listeners.forEach(fn=>fn());});expect(close).toHaveBeenCalled();await act(async()=>button('Copy link').click());expect(writeText).not.toHaveBeenCalled();expect(mock.create).toHaveBeenCalledOnce();
});
