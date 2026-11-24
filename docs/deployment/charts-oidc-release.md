# Charts release without a Mac AWS login

This is a review candidate, not an applied release. No role, invocation permission,
route, code, frontend, feature flag, provider setting, secret or song data was
changed while preparing these files. It is stacked on the reviewed multi-book
invitation source; review only this branch's additional automation diff or
cherry-pick its automation commit after reconciling that source through normal PR
checks. This does not enable or send invitations.

## One-time setup to review separately

The existing account OIDC provider is
`arn:aws:iam::637423285747:oidc-provider/token.actions.githubusercontent.com`, with
`sts.amazonaws.com` audience. Create `NotationChartsRelease` with the exact
`infra/release/charts-release-trust.json` and
`infra/release/charts-release-policy.json` after action-time authorization. There
are no access keys, root keys, GitHub secrets or new provider required. A future
workflow gets a short-lived role session through OIDC. This draft does not apply
IAM or run CDK.

The role is production authority: it can replace the existing Charts Lambda's
code, which then executes with that function's existing execution role and its
access to application data/secrets. It also publishes Charts frontend objects,
adds API routes on the existing API and invalidates its distribution. It has no
IAM, PassRole, configuration update, alias, SecretsManager API grants, direct song data API,
function creation/deletion, route edit/delete or S3 delete permissions. GetFunction
and GetFunctionConfiguration can read function code and environment values; the
helper keeps those values out of logs and artifacts. API Gateway
POST permission is scoped to the existing API's route collection; the reviewed
helper restricts actual route creation to four paths. IAM does not enforce that
four-route allowlist itself.

The trust accepts `repo:gibsonds/NotationApp:ref:refs/heads/main`. **Any workflow on
main with `id-token: write` can assume this role**, not only Release Charts.
Protect main and require normal reviewed PRs and successful checks for workflow
changes. The existing rulesets require a PR, resolved threads, strict test/audit/
security/analyze checks and the CodeQL severity gate, and prohibit force pushes
and deletion. This workflow adds no bypass and does not approve or merge a PR.
It intentionally has no GitHub environment: a default environment OIDC subject
would differ from this reviewed main-ref trust. If stronger workflow-specific or
environment approval controls are wanted, review the matching OIDC trust first.

The existing Lambda invocation policy must separately allow the four new route
ARNs. `infra/release/charts-invite-invoke-statements.json` is **four additions**, not
a replacement policy. Preserve all existing statements. Each allows only
apigateway.amazonaws.com, source account 637423285747, exact API xg47257esd,
$default stage and the listed method/path. Parameter paths use literal `{token}`,
matching AWS CDK HttpLambdaIntegration's route-template permission convention.
Do not give AddPermission to the release role. The helper fails before code or
site changes if this coverage is absent or ambiguous.

## Release procedure after reviewed merge

1. Merge through the repository's normal protections and wait for the final main
   commit's test, dependency-audit, security-tests, analyze and CodeQL checks.
2. In Actions → Release Charts → Run workflow, select main, paste its full commit
   SHA, and enter `charts.collisionstorm.com`. No AWS login on the Mac is needed.
3. Read the run result and exact-commit live verification. A failed or uncertain
   operation needs inspection; do not blindly re-run a production write.

The build job has no OIDC permission. It installs the lockfiles on Node 22, runs
full tests, type checking, infrastructure compilation, static hardening tests,
root/infrastructure dependency audits, and builds the authenticated backend plus
static frontend. No CDK synth/deploy or unrelated site release runs. The release
job installs no packages and runs no dependency scripts. It downloads only that
same run's artifact, checks file hashes, rejects symlinks, rechecks current main
and exact-head CI, and assumes the exact scoped role for at most 30 minutes.
Check names are bound to the observed GitHub Actions app ID15368 and CodeQL
app ID57789; new or renamed checks need a reviewed helper change.

Targets are fixed: account637423285747/us-east-1, existing
NotationAuth-Handler886CB40B-VONw1UHVaz0k, APIxg47257esd and its verified integration
kpcfvrc, bucketnotationauth-sitebucket397a1860-m0gyarsr1okt,
distributionE1OQKQ4KGT4DXV, and charts.collisionstorm.com. The helper resolves and
verifies the existing integration metadata, API stage auto-deploy, public API
origin and default S3 origin; it never changes those settings. A changed target,
runtime, handler, cookie/origin config or feature assertion stops the release.

`charts-release-config.json` asserts both invitation features **false**. The
build explicitly passes both corresponding public flags as0; the helper verifies
matching existing backend gates and never changes configuration. Email delivery,
verified-email claims/scopes/provider settings, recipient identity and the actual
books/roles require their own reviewed configuration and end-to-end preflight.
This automation alone does not make Jon's invitation ready to send.

## Rollback and partial failure

Before code/routes/frontend writes, validate every target and capture versioned
S3 object provenance plus the current public HTML. Require S3 versioning already
enabled. Reuse an existing immutable Lambda version only when its code hash and
relevant configuration hash exactly match current $LATEST, otherwise publish a
new version guarded by both current CodeSha256 and RevisionId. Publishing a
version changes no $LATEST code/configuration or alias. Save only the immutable
version ARN/number, hashes, revision, route metadata and S3 version IDs; **never
save the live ZIP, raw environment, GetFunction signed URL or credentials into
this public repository's artifacts**. A new build artifact contains only the
public repository source/dependency bundle and public frontend build, with no
runtime configuration or credentials.

The rollback metadata upload must finish before application writes. A second
preflight proves that current backend revision/site versions have not changed and
that the immutable Lambda backup still matches. Update Lambda code using the
revision guard, wait, verify its exact bundle hash and unchanged configuration,
then add only missing allowlisted routes. Existing routes are never edited.
Upload each bounded frontend object directly with PutObject, assets before HTML;
keep all previous objects. HTML is no-cache/no-store; hashed assets are immutable.
Invalidate only this distribution and wait for completion. Compare every generated
frontend file with production bytes and confirm signed-out /auth-api/me is401.
No login, signup, song write, import, acceptance or email send occurs.

If a write fails after some earlier writes succeeded, the helper stops and keeps
metadata; **this is not an atomic whole-site release or an automatic rollback**.
New routes cannot be removed with this role. A reviewed rollback may restore the
old frontend object versions and download the immutable Lambda backup privately
using GetFunction with its version qualifier, then update only $LATEST code. Do
not copy configuration from an older version automatically. Restoring frontend
versions does not remove newly added objects; old HTML references preserved old
assets. Deleting routes or changing settings needs separate bounded authority.
Do not print a GetFunction response or signed URL while preparing a rollback.

## Validation and limitations

Local unit tests use only synthetic files and mocked AWS/GitHub/network calls.
They exercise exact-head/provider checks, tampering/symlinks, feature assertions,
route policy templates, version reuse/publication, concurrent source changes,
write ordering and no route/config/data deletion. Run:

```sh
python3 -m unittest discover -s scripts/tests -p 'test_charts_release.py'
bash -n scripts/build-charts-release.sh
python3 -m py_compile scripts/charts_release.py
```

The actual GitHub OIDC exchange, live IAM policy, version publication, API route
creation, S3 writes and production smoke remain unexecuted in this draft. Their
first authorized run is necessary to establish live compatibility. No claim of a
completed release or ready-to-send invitation follows from local mock tests.
