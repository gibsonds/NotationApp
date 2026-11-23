"use client";

import { useEffect, useRef, useState } from 'react';
import { getSnapshot, subscribe } from '@/lib/auth';
import { createBookInvitation, invitationCapabilities, type SharedBook } from '@/lib/songbook-client';

/** Preview first; a second explicit submit issues exactly this frozen selection. */
export default function MultiBookInviteComposer({onClose}:{onClose:()=>void}) {
  const [start] = useState(getSnapshot);
  const owners = start.memberships.filter(b=>b.role === 'owner');
  const [selected,setSelected] = useState<string[]>([]);
  const [roles,setRoles] = useState<Record<string,SharedBook['role']>>({});
  const [email,setEmail] = useState('');
  const [emailEnabled,setEmailEnabled] = useState(false);
  const [review,setReview] = useState<SharedBook[] | null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [result,setResult] = useState<{link:string;delivery:string} | null>(null);
  const requestId = useRef('');
  const heading = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(()=> { heading.current?.focus(); let live=true;
    void invitationCapabilities().then(c=>{if(live)setEmailEnabled(c.emailDelivery);}).catch(()=>{});
    const unsubscribe = subscribe(()=> { const now=getSnapshot(); if(now.status !== 'signed-in' || now.claims?.sub !== start.claims?.sub || now.activeSongbookId !== start.activeSongbookId) onClose(); });
    return ()=>{live=false;unsubscribe();};
  },[onClose,start]);
  useEffect(()=> { const key=(e:KeyboardEvent)=>{if(e.key==='Tab') {const controls=Array.from(form.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)')??[]);const first=controls[0],last=controls.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}if(e.key==='Escape'){e.stopPropagation();if(!busy)onClose();}};window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);},[busy,onClose]);
  async function submit() {
    if (busy) return;
    if (!review) {setReview(owners.filter(b=>selected.includes(b.songbookId)).map(b=>({songbookId:b.songbookId,name:b.name,role:roles[b.songbookId] ?? 'viewer'})));requestId.current=crypto.randomUUID();return;}
    setBusy(true);setError('');
    try {
      const r=await createBookInvitation(review,requestId.current,email.trim() || undefined);
      // Never display a result in a different account's composer.
      if(getSnapshot().claims?.sub !== start.claims?.sub) return;
      const url=new URL('/',window.location.origin);url.searchParams.set('invite',r.token);
      setResult({link:url.toString(),delivery:r.delivery});
    } catch(e) {setError(e instanceof Error?e.message:'Could not create invitation.');}
    finally {setBusy(false);}
  }
  return <div className="fixed inset-0 z-[110] bg-black/40 flex items-start justify-center pt-[8vh]" onClick={()=>{if(!busy)onClose();}}>
    <form ref={form} role="dialog" aria-modal="true" aria-labelledby="multi-invite-title" className="w-[560px] max-w-[92vw] bg-white rounded-xl shadow-xl text-gray-800" onClick={e=>e.stopPropagation()} onSubmit={e=>{e.preventDefault();void submit();}}>
      <header className="px-5 py-3 border-b flex items-center justify-between"><h2 ref={heading} tabIndex={-1} id="multi-invite-title" className="font-semibold">{result?'Invitation ready':review?'Review invitation':'Share songbooks'}</h2><button type="button" aria-label="Close invitation" disabled={busy} onClick={onClose} className="w-11 h-11 rounded-lg hover:bg-gray-100">×</button></header>
      <div className="px-5 py-4 space-y-3 max-h-[58vh] overflow-y-auto">
        <p className="text-sm text-gray-600">Only the selected songbooks are shared. Choose access for each book. Existing members keep their current access, even when the invitation offers a different role.</p>
        {(review ?? owners).map(b=><div key={b.songbookId} className="flex flex-wrap items-center gap-3 min-h-11 py-2 border-b">
          <label className="flex flex-1 items-center gap-3 min-w-0 min-h-11">
            {!review && <input type="checkbox" aria-label={`Select ${b.name}`} checked={selected.includes(b.songbookId)} disabled={!selected.includes(b.songbookId)&&selected.length>=10} onChange={e=>{setSelected(s=>e.target.checked?[...s,b.songbookId]:s.filter(id=>id!==b.songbookId));setRoles(r=>({...r,[b.songbookId]:'viewer'}));}}/>}
            <span className="break-words min-w-0">{b.name}</span>
          </label>
          {review ? <span className="text-sm font-medium">{b.role === 'editor' ? 'Editor' : 'Viewer'} for new members</span> :
            <select aria-label={`Access for ${b.name}`} value={roles[b.songbookId] ?? 'viewer'} disabled={!selected.includes(b.songbookId)} onChange={e=>setRoles(r=>({...r,[b.songbookId]:e.target.value as SharedBook['role']}))} className="min-h-11 border rounded-lg px-3 focus:outline-none focus:ring-2 focus:ring-blue-500"><option value="viewer">Viewer</option><option value="editor">Editor</option></select>}
        </div>)}
        <p className="text-sm text-gray-600">Viewer: read songs. Editor: add and change songs and save named revisions. Neither role can delete songs, manage members, or transfer ownership. Existing members are never upgraded or downgraded by an invitation.</p>
        {!owners.length && <p>You don’t own any songbooks. Only owners can issue invitations.</p>}
        {!review && <p className="text-sm text-gray-500">Select up to ten books. A book containing personal or unreleased songs should stay unchecked.</p>}
        <label className="block text-sm">{review?'Recipient':'Email recipient (optional)'}<input type="email" maxLength={254} value={email} disabled={!emailEnabled||!!review} onChange={e=>setEmail(e.target.value)} placeholder={emailEnabled?'Leave empty for a private link':'Verified email delivery is not enabled'} className="mt-1 min-h-11 w-full border rounded-lg px-3 py-2 disabled:bg-gray-50"/></label>
        {!email && <p className="text-sm text-gray-600">Private link: anyone holding it can accept once. Send it only to the intended person. It expires in 48 hours.</p>}
        {email && <p className="text-sm text-gray-600">One email goes to {email}. Acceptance requires that verified mailbox. No account lookup is performed.</p>}
        {result && <><p role="status">{result.delivery==='sent'?'One invitation email was sent.':result.delivery==='unconfirmed'?'Email delivery is unconfirmed. It will not be resent automatically.':'Copy this private invitation link.'}</p><input aria-label="Invitation link" readOnly value={result.link} onFocus={e=>e.target.select()} className="w-full min-h-11 border rounded-lg px-3 py-2"/></>}
        {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
      </div>
      <footer className="px-5 py-3 border-t flex gap-2 justify-end">
        <button type="button" disabled={busy} onClick={onClose} className="min-h-11 px-4 text-sm rounded-lg hover:bg-gray-100">{result?'Done':'Cancel'}</button>
        {review&&!result&&<button type="button" disabled={busy} onClick={()=>{setReview(null);setError('');}} className="min-h-11 px-4 text-sm rounded-lg hover:bg-gray-100">Change selection</button>}
        {!result&&<button type="submit" disabled={busy||(!review&&!selected.length)} className="min-h-11 px-4 text-sm text-white bg-blue-600 rounded-lg disabled:opacity-50">{busy?'Working…':review?(email?'Send one invitation':'Create private link'):'Review selected books'}</button>}
      </footer>
    </form>
  </div>;
}
