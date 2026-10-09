import {beforeEach,afterEach,it,expect,vi} from 'vitest';
beforeEach(()=>{vi.resetModules();localStorage.clear();sessionStorage.clear();});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it('keeps AI keys tab-only and moves legacy persistent keys out of local storage',async()=>{
 const keys=await import('../api-key-store');
 keys.setApiKey('openai','sk-example-secret');
 expect(localStorage.getItem('notation-app-api-keys')).toBeNull();
 expect(keys.getApiKey('openai')).toBe('sk-example-secret');
 sessionStorage.clear();localStorage.setItem('notation-app-api-keys',JSON.stringify({anthropic:'sk-old'}));
 expect(keys.getApiKey('anthropic')).toBe('sk-old');expect(localStorage.getItem('notation-app-api-keys')).toBeNull();
});
it('cookie login persists only opaque identity metadata, never OAuth credentials',async()=>{
 vi.stubEnv('NEXT_PUBLIC_COOKIE_SESSIONS','1');vi.stubEnv('NEXT_PUBLIC_OAUTH_ISSUER','https://issuer.test');vi.stubEnv('NEXT_PUBLIC_OAUTH_CLIENT_ID','client');vi.stubEnv('NEXT_PUBLIC_API_BASE','/auth-api');
 const auth=await import('../auth');
 sessionStorage.setItem('notation-app-pkce',JSON.stringify({verifier:'v',state:'s'}));
 const fetch=vi.fn(async(url:string)=>new Response(JSON.stringify(url.endsWith('/me')?{sub:'opaque',email:'do-not-store@example.test',memberships:[{songbookId:'b',name:'Book',role:'owner'}]}:{ok:true}),{status:200}));
 vi.stubGlobal('fetch',fetch);
 expect(await auth.completeSignIn('code','s')).toBe(true);
 expect(JSON.parse(localStorage.getItem('notation-app-auth')!)).toEqual({claims:{sub:'opaque'}});
 expect(JSON.stringify(fetch.mock.calls)).not.toContain('Bearer');
});
