import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AuthSnapshot } from "@/lib/auth";
import AccountStatus from "../AccountStatus";

const model = vi.hoisted(() => ({ snapshot: null as AuthSnapshot | null, listeners: new Set<()=>void>(), current: true, enabled: true }));
vi.mock("@/lib/auth", () => ({
  get AUTH_ENABLED() { return model.enabled; },
  getSnapshot: () => model.snapshot,
  subscribe: (fn:()=>void) => { model.listeners.add(fn); return ()=>model.listeners.delete(fn); },
  signOut: vi.fn(), beginSignIn: vi.fn(),
}));
vi.mock("@/lib/songbook-storage", () => ({ songbookScopeIsCurrent: () => model.current }));
let root: Root, mount: HTMLDivElement;
function state(sub = "opaque-a"): AuthSnapshot {
  return { status: "signed-in", claims: { sub, email: "unverified@gmail.com", name: "Unverified name" },
    verifiedAccount: { sub }, activeSongbookId: "a", memberships: [{ songbookId: "a", name: "Band book", role: "viewer" }] };
}
beforeEach(async () => {
  model.snapshot=state();model.current=true;model.enabled=true;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  mount=document.createElement("div");document.body.append(mount);root=createRoot(mount);
  await act(async()=>root.render(<AccountStatus />));
});
afterEach(async()=>{await act(async()=>root.unmount());mount.remove();model.listeners.clear();vi.unstubAllGlobals();});
async function open() { await act(async()=>mount.querySelector<HTMLButtonElement>('[aria-label="Account details"]')!.click()); }
async function update(next: AuthSnapshot) { await act(async()=>{model.snapshot=next;model.listeners.forEach(f=>f());}); }
it("separates the book and status and displays only the verified opaque account ID",async()=>{
  expect(mount.textContent).toContain("Book: Band book");expect(mount.textContent).toContain("Signed in");await open();
  const dialog=document.querySelector('[role="dialog"]')!;expect(dialog.textContent).toContain("opaque-a");
  expect(dialog.textContent).not.toContain("unverified@gmail.com");expect(dialog.textContent).not.toContain("Unverified name");
  const method=Array.from(dialog.querySelectorAll("dt")).find(e=>e.textContent==="Sign-in method")!;
  expect(method.nextElementSibling?.textContent).toBe("Not provided for this session.");
});
it("never presents cached claims as a verified identity",async()=>{
  await update({...state(),verifiedAccount:null});await open();
  const text=document.querySelector('[role="dialog"]')!.textContent;
  expect(text).toContain("Unavailable until this session is verified");expect(text).not.toContain("opaque-a");
});
it("closes and clears old identity details when another account is verified",async()=>{
  await open();await update(state("opaque-b"));expect(document.querySelector('[role="dialog"]')).toBeNull();
  await open();expect(document.querySelector('[role="dialog"]')!.textContent).toContain("opaque-b");
  expect(document.body.textContent).not.toContain("opaque-a");
});
it("hides details immediately on sign-out and does not reopen after a later login",async()=>{
  await open();await update({...state(),status:"signed-out",claims:null,verifiedAccount:null});
  expect(document.querySelector('[role="dialog"]')).toBeNull();expect(document.body.textContent).not.toContain("opaque-a");
  await update(state());expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("hides account details when the page no longer owns the current book/account scope",async()=>{
  await open();model.current=false;await update({...state(),verifiedAccount:null});
  expect(document.querySelector('[role="dialog"]')).toBeNull();expect(mount.textContent).toBe("Updating account…");
});
it("supports Escape and returns focus to the account control",async()=>{
  const trigger=mount.querySelector<HTMLButtonElement>('[aria-label="Account details"]')!;trigger.focus();await open();
  await act(async()=>window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));
  expect(document.querySelector('[role="dialog"]')).toBeNull();expect(document.activeElement).toBe(trigger);
});
