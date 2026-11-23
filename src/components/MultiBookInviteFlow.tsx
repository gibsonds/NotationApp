"use client";
import { useEffect, useEffectEvent, useState, useSyncExternalStore } from 'react';
import { beginSignIn, getSnapshot, subscribe, setActiveSongbook, signOut } from '@/lib/auth';
import { previewInvitation, acceptBookInvitation, type InvitationPreview } from '@/lib/songbook-client';
import InviteLanding from './InviteLanding';

type Props={token:string;ready:boolean;signedIn:boolean;authError?:string;onLeave:()=>void};
export default function MultiBookInviteFlow({token,ready,signedIn,authError,onLeave}:Props) {
  const auth=useSyncExternalStore(subscribe,getSnapshot,getSnapshot);
  return <InvitationSession key={`${token}:${auth.claims?.sub}:${signedIn}`} token={token} ready={ready} signedIn={signedIn} authError={authError} onLeave={onLeave} sub={auth.claims?.sub}/>;
}
function InvitationSession({token,ready,signedIn,authError,onLeave,sub}:Props&{sub?:string}) {
  const [preview,setPreview]=useState<InvitationPreview|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const current=signedIn?preview:null;
  const openExisting=useEffectEvent((value:InvitationPreview)=>{onLeave();setActiveSongbook(value.books[0].songbookId);});
  useEffect(()=>{let canceled=false;
    if(ready&&signedIn&&sub) void previewInvitation(token).then(value=>{
      if(canceled||getSnapshot().claims?.sub!==sub)return;
      setPreview(value);
      if(value.allMember)openExisting(value);
    }).catch(e=>{if(!canceled)setError(e.message);});
    return()=>{canceled=true;};
  },[token,ready,signedIn,sub]);
  async function advance(){if(busy)return;setBusy(true);setError('');
    try{
      if(!signedIn){await beginSignIn();return;}
      if(!current)throw new Error('Review the invitation before joining.');
      const books=await acceptBookInvitation(token);
      if(getSnapshot().claims?.sub!==sub)return;
      if(!books.length||!books.every(b=>getSnapshot().memberships.some(m=>m.songbookId===b.songbookId)))throw new Error('Joined, but the book list could not refresh. Reload to check your access.');
      onLeave();setActiveSongbook(books[0].songbookId);
    }catch(e){setError(e instanceof Error?e.message:'Could not continue.');}finally{setBusy(false);}
  }
  return <InviteLanding phase={!ready?'loading':signedIn?'join':'sign-in'} busy={busy} error={error||authError} onContinue={advance} onLeave={onLeave}
    books={current?.books} multiple disableContinue={signedIn&&!current} onSwitchAccount={signedIn?async()=>{setPreview(null);setError('');try{await signOut();}catch{setError('Could not sign out. Please try again.');}}:undefined}/>;
}
