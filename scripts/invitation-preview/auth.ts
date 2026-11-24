// Browser-only simulated auth. No provider URL, real account or persistent credential.
export const COOKIE_SESSIONS=false;
export const browserRequestHeaders=()=>({});
let snapshot={status:'signed-in',claims:{sub:sessionStorage.getItem('preview-sub')??'owner'},activeSongbookId:'a',memberships:[] as any[]};
const listeners=new Set<()=>void>();
export const subscribe=(fn:()=>void)=>{listeners.add(fn);return()=>listeners.delete(fn);};
export const getSnapshot=()=>snapshot;
export const getAccessToken=async()=>`preview-${snapshot.claims.sub}`;
export async function loadMe(){const res=await fetch('/api/me',{headers:{authorization:await getAccessToken()}});const out=await res.json();snapshot={...snapshot,memberships:out.memberships};listeners.forEach(fn=>fn());return out.memberships;}
export async function persona(sub:string){sessionStorage.setItem('preview-sub',sub);snapshot={...snapshot,status:sub==='signed-out'?'signed-out':'signed-in',claims:{sub},memberships:[]};await loadMe();}
export const beginSignIn=()=>persona('new-user');
export const signOut=()=>persona('signed-out');
export function setActiveSongbook(id:string){snapshot={...snapshot,activeSongbookId:id};listeners.forEach(fn=>fn());window.dispatchEvent(new CustomEvent('preview-book-opened',{detail:id}));}
