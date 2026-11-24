"use client";
import { useEffect, useEffectEvent, useState, useSyncExternalStore } from 'react';
import { beginSignIn, getSnapshot, subscribe, setActiveSongbook, signOut, loadMe, type Membership } from '@/lib/auth';
import { previewInvitation, acceptBookInvitation, type InvitationPreview } from '@/lib/songbook-client';
import InviteLanding from './InviteLanding';

type Props={token:string;ready:boolean;signedIn:boolean;authError?:string;onLeave:()=>void;onOpenBook?:()=>void};
export default function MultiBookInviteFlow({token,ready,signedIn,authError,onLeave,onOpenBook}:Props) {
  const auth=useSyncExternalStore(subscribe,getSnapshot,getSnapshot);
  return <InvitationSession key={`${token}:${auth.claims?.sub}:${signedIn}`} token={token} ready={ready} signedIn={signedIn} authError={authError} onLeave={onLeave} onOpenBook={onOpenBook} sub={auth.claims?.sub}/>;
}
function InvitationSession({token,ready,signedIn,authError,onLeave,onOpenBook,sub}:Props&{sub?:string}) {
  const [preview,setPreview]=useState<InvitationPreview|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const current=signedIn?preview:null;
  function openBook(id:string) {
    const alreadyActive=getSnapshot().activeSongbookId===id;
    // Selection can fail (for example blocked storage). Keep the invitation
    // available until the verified destination has been selected successfully.
    setActiveSongbook(id,true,{reopenMySongs:true});
    onLeave();
    if(alreadyActive)onOpenBook?.();
  }
  function verifyBooks(value:InvitationPreview,books:Membership[]) {
    const account=getSnapshot();
    if(!sub || account.status!=='signed-in' || account.claims?.sub!==sub || account.verifiedAccount?.sub!==sub)throw new Error('Your session changed. Review the invitation again.');
    if(!value.books.length || books.length!==value.books.length || !value.books.every(i=>books.some(b=>b.songbookId===i.songbookId)) || !value.books.every(i=>account.memberships.some(m=>m.songbookId===i.songbookId)))throw new Error('Charts couldn’t refresh the selected songbooks. Reload to check your access.');
    return value.books.map(i=>account.memberships.find(m=>m.songbookId===i.songbookId)!);
  }
  function openVerifiedBooks(value:InvitationPreview,books:Membership[]) {
    verifyBooks(value,books);
    openBook(value.books[0].songbookId);
  }
  const openExisting=useEffectEvent(async(value:InvitationPreview,isCanceled:()=>boolean)=>{
    // A verified preview does not refresh the editor's cached membership roles.
    // Refresh before opening even an already-active book after a downgrade.
    const books=await loadMe();
    if(isCanceled())return;
    const selected=books.filter(b=>value.books.some(i=>i.songbookId===b.songbookId));
    const refreshed=verifyBooks(value,selected);
    if(refreshed.some((book,index)=>book.role!==value.books[index].role)){
      setPreview({...value,books:value.books.map((book,index)=>({...book,existingRole:refreshed[index].role,effectiveRole:refreshed[index].role}))});
      return;
    }
    openVerifiedBooks(value,selected);
  });
  useEffect(()=>{let canceled=false;
    if(ready&&signedIn&&sub) void previewInvitation(token).then(async value=>{
      if(canceled||getSnapshot().claims?.sub!==sub)return;
      setPreview(value);
      if(value.allMember && value.books.every(b=>b.existingRole===b.role)){
        setBusy(true);
        try{await openExisting(value,()=>canceled);}finally{if(!canceled)setBusy(false);}
      }
    }).catch(e=>{if(!canceled)setError(e.message);});
    return()=>{canceled=true;};
  },[token,ready,signedIn,sub]);
  async function advance(){if(busy)return;setBusy(true);setError('');
    try{
      if(!signedIn){await beginSignIn();return;}
      if(!current)throw new Error('Review the invitation before joining.');
      // An existing member reviewing a role mismatch only opens their books;
      // no acceptance or role write is needed to retain current access.
      const books=current.allMember ? (await loadMe()).filter(b=>current.books.some(i=>i.songbookId===b.songbookId)).sort((a,b)=>a.songbookId.localeCompare(b.songbookId)) : await acceptBookInvitation(token);
      openVerifiedBooks(current,books);
    }catch(e){setError(e instanceof Error?e.message:'Could not continue.');}finally{setBusy(false);}
  }
  return <InviteLanding phase={!ready?'loading':signedIn?'join':'sign-in'} busy={busy} error={error||authError} onContinue={advance} onLeave={onLeave}
    books={current?.books} multiple continueLabel={current?.allMember ? 'Open existing songbooks' : undefined} disableContinue={signedIn&&!current} onSwitchAccount={signedIn?async()=>{setPreview(null);setError('');try{await signOut();}catch{setError('Could not sign out. Please try again.');}}:undefined}/>;
}
