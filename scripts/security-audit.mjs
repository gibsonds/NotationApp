import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
// No advisory exceptions. GHSA-vfj7-8cjw-p6xm was withdrawn on 2026-10-23.
let failed=false;
for(const dir of ['.','infra']) {
 const result=spawnSync('npm',['audit','--json'],{cwd:dir,encoding:'utf8'});
 let audit;try{audit=JSON.parse(result.stdout);}catch{throw new Error(`Audit unavailable for ${dir}: ${result.stderr}`);}
 if(audit.error) throw new Error(`Audit registry error: ${audit.error.code}`);
 writeFileSync(dir==='.'?'security-audit-app.json':'security-audit-infra.json',JSON.stringify(audit,null,2));
 const runtime=spawnSync('npm',['audit','--omit=dev','--audit-level=moderate','--json'],{cwd:dir,encoding:'utf8'});
 if(runtime.status!==0) {console.error(`${dir}: runtime dependency audit failed`);failed=true;}
 const advisories=new Map();
 for(const v of Object.values(audit.vulnerabilities??{})) for(const via of v.via??[]) if(typeof via==='object') advisories.set(via.url,via);
 for(const [url,v] of advisories) {
  console.log(`${dir}: ${v.severity} ${url}`);
  if(['moderate','high','critical'].includes(v.severity)) failed=true;
 }
 console.log(`${dir}: ${JSON.stringify(audit.metadata?.vulnerabilities??{})}`);
}
if(failed)process.exitCode=1;
