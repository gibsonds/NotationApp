# InferMusic hosting

## Intended organization

| Address | Product | Hosting / source |
| --- | --- | --- |
| `infermusic.ai` and `www.infermusic.ai` | InferMusic home | InferMusic stack; `sites/infermusic/index.html` |
| `charts.infermusic.ai` | InferMusic Charts | Existing NotationAuth stack and database; NotationApp repository |
| `scales.infermusic.ai` | InferMusic Scales | InferMusic stack; pinned public guitar-scales build; existing ScalesAppProd API/database |

## Live previews (2026-10-09)

- Home: https://d29r1ufetrv7gh.cloudfront.net
- Charts: https://d1ptfjofjtkwqr.cloudfront.net
- Scales: https://dop9gdwh3ja0h.cloudfront.net

The GitHub Pages sites remain available. This setup does not migrate or delete songs or practice sessions.

## Registration and DNS — pending

The domain was available at the last registrar check. No registration has been purchased. AWS quoted USD 137/year; `.ai` has a two-year minimum (USD 274 before applicable tax). The user has been asked to choose their registrar before any purchase.

The Route 53 hosted zone is already prepared: `Z0255034BY58BRDL447S` in stack `InferMusicDns`.

Set these nameservers at the chosen registrar:

```
ns-1888.awsdns-44.co.uk
ns-9.awsdns-01.com
ns-808.awsdns-37.net
ns-1116.awsdns-11.org
```

An ACM certificate for the apex, www, charts, and scales names is pending DNS validation in us-east-1:

```
arn:aws:acm:us-east-1:637423285747:certificate/5b4e2b63-ab68-40b9-9cf9-5efe64eaee62
```

`node scripts/prepare-infermusic-domain.mjs` idempotently prepares its validation records and prints the nameservers. It does not register or purchase a domain. If registration is delayed long enough for validation to time out, run it again to request a fresh certificate.

## Custom-domain activation

1. Register the domain and delegate its nameservers to the prepared zone.
2. Confirm ACM status is `ISSUED` and the certificate includes all four hostnames.
3. Update the OAuth42 app registration to allow the exact callback `https://charts.infermusic.ai/`. Keep `https://d1ptfjofjtkwqr.cloudfront.net/` during transition. OAuth42 sign-in has been verified on the preview; test the new callback before retiring the preview.
4. Deploy **only** `InferMusic` and `NotationAuth` with both CDK context values:
   - `infermusicHostedZoneId=Z0255034BY58BRDL447S`
   - `infermusicCertificateArn=<issued certificate ARN>`
5. Keep the public OAuth client ID and issuer configured. The app's confidential client credential is read from Secrets Manager (`NotationApp/oauth42/client-secret`); never place its value in CDK context, templates, source, or frontend builds. `scripts/prepare-oauth-secret.py` supports the one-time migration from the old Lambda environment.
6. Re-run `scripts/deploy-auth-frontend.sh` and `node scripts/deploy-infermusic.mjs --publish`. The scripts read stack outputs, so app links and the scales API's allowed origin use the custom names once activated.
7. In GuitarLLM's scales infrastructure, deploy with `-c infermusicScalesOrigin=https://scales.infermusic.ai` so later API deployments preserve the new CORS origin. Its default currently permits the preview.
8. Verify HTTPS, cross-app navigation, scales JSON/chord loading, API preflight responses, and OAuth42 sign-in.

No aliases are attached until both the certificate and zone are supplied. The existing charts distribution and all databases are reused.

## Publishing

- `npm run build --prefix infra` checks infrastructure types.
- `cd infra && npx cdk deploy InferMusic --require-approval never` deploys home/scales hosting.
- `node scripts/deploy-infermusic.mjs` prepares reviewable files in a temporary directory.
- `node scripts/deploy-infermusic.mjs --publish` publishes those files, adds the actual scales origin to existing API CORS settings, and invalidates both CloudFront caches.
- `NEXT_PUBLIC_OAUTH_CLIENT_ID=<public id> AWS_DEFAULT_REGION=us-east-1 bash scripts/deploy-auth-frontend.sh` publishes Charts and adds a home link from the InferMusic stack output.

The scales build is pinned to `gibsonds/guitar-scales@6511e01d56b66730c53c1b1a1a1d6f35ae237242` (the same commit referenced by GuitarLLM's `github-pages` gitlink). Publishing copies its scale/chord data and app files and applies only the InferMusic title, footer, and navigation. Update the pin deliberately when promoting an upstream release.

## Existing browser data

Browser storage is tied to an origin. A custom domain therefore starts with a separate local cache.

- Charts: sign in and sync the same account/songbook. Legacy GitHub Pages songs can be copied using the authenticated app's import flow after signing in.
- Scales: on the old site open **Diary → Devices**, copy the device ID, then use **Switch to another device's data** in the new site's Devices panel. The existing cloud diary remains in the same backend. Do this before logging new practice sessions in the new origin.

Shared branding does not currently imply shared authentication: Charts uses OAuth42; Scales continues to use its existing device-based diary sync.

## Security and privacy operating model

Security hardening dated 2026-10-09:

- Authenticated Charts uses same-origin `/auth-api` requests and random, revocable `Secure; HttpOnly; SameSite=Lax` cookies. Sessions expire absolutely after 12 hours. The server retains only a hash of the random cookie, the opaque OAuth42 subject, and expiry. It discards OAuth access, ID, and refresh tokens after sign-in. A legacy access-token migration endpoint closes on 2026-10-16.
- Sign-in requests only `openid`. Charts does not need names, emails, avatars, or provider profiles. Ownership, membership, removal records, saved-by references, and rate counters retain opaque IDs. These are pseudonymous data, not anonymity. Songbook names and song content can themselves contain personal information supplied by users. OAuth42 separately manages its own login records.
- The app's own OAuth confidential-client credential lives in Secrets Manager. This is distinct from users' AI credentials. Retiring that credential's old versions in CloudFormation history requires rotation at OAuth42; do not print it while investigating configuration.
- AI provider keys are held only in page memory, removed on reload, tab close, or sign-out; existing persistent keys migrate on access. Hosted static builds send AI requests directly from the browser to the selected provider. Local development routes can relay them. No user key vault is deployed. Page memory remains accessible to scripts executing on the origin and by some extensions; this is an interim personal-use option, not the recommended public onboarding model.
- Recommended public AI design: do not request users' provider keys. Use an app-owned server-side credential with authenticated access, per-user daily budgets, a global enforced spend ceiling, request/token limits, and no prompt/key logging; alternatively use provider-supported narrowly scoped delegation after verifying its actual permissions, expiry, and revocation. Provider billing alerts alone are not spending caps. No paid AI service is enabled by this change.
- Invitations are consumed atomically, expire after at most 48 hours, and cannot remove another book's invitation. Removing a member blocks their older invitation links. Owners manage access using opaque account IDs. Downloaded copies cannot be recalled.
- API rate throttles, the existing account-wide Lambda concurrency cap of 10, request-size checks, and per-account operation/storage allocation limits bound abuse. AWS requires those 10 slots to remain unreserved, so apps currently share that cap and can affect each other’s availability. Raising the account quota must include revisiting per-function reservations. These controls reduce exposure but do not provide a guaranteed AWS dollar cap. Existing storage is not retroactively counted in the new allocation counters.
- Minimal API logs retain random request IDs, route templates, status, and latency for seven days; application errors omit bodies and credentials. No client IP/user-agent logging is configured by these changes. Expired sessions/counters become unusable immediately; DynamoDB TTL deletion is asynchronous. The song table has 35-day recovery history, so previously stored attributes can remain in recovery points until they age out.
- Sign-out revokes the current session; **Sign out & clear this device** additionally removes local app caches after confirmation. Regular sign-out preserves local song caches. There is no complete account-deletion workflow yet.
- CloudFront adds CSP and security headers. Published Charts HTML includes an additional hash-based script CSP. S3 versioning, database deletion protection, and recovery are enabled. CloudWatch alarms currently record alarm state; notification destinations must still be configured.

### Recurring checks

| Trigger | Checks |
| --- | --- |
| Each pull request and main push | Tests, auth/isolation regressions, dependency audit, CodeQL security analysis |
| Every Monday | Dependency audit and CodeQL, even when no code changes; Dependabot proposes npm and Actions updates |
| First of each month / manual | Deployed AWS configuration checks using a GitHub OIDC role restricted to metadata; no standing AWS key in GitHub |
| Quarterly and before changing auth, sharing, AI, or hosting | Human threat review: two-account authorization tests, removal/re-invitation, recovery drill, IAM scope, privacy retention, provider changes |

Run `node scripts/security-audit.mjs` locally. Production and infrastructure dependencies must have no moderate-or-higher findings. The unpatched development-only ESLint `braces` advisory `GHSA-vfj7-8cjw-p6xm` has an explicit exception expiring **2026-11-08**; an expired exception fails CI. Actions are pinned to commit hashes. Review findings; do not auto-merge security updates without passing checks. GitHub notification delivery depends on the maintainer's Actions/Security notification settings.

AWS metadata checks: `python3 scripts/audit-aws.py`. The monthly workflow assumes `NotationSecurityAudit` via OIDC only from this repository's main branch. It cannot read songs or secret values. It can inspect Lambda configuration, so keeping secrets out of inline environment variables is a required check.

### Remaining coordinated steps

1. Validate the MFA-protected `NotationFrontendDeploy` role with the owner, then replace the workstation's broad admin credentials with appropriate temporary scoped access. Do not revoke the only working admin path before validating recovery and infrastructure maintenance access. This remains the largest account-wide blast radius.
2. Finish copying/verifying legacy songs (including the working Sleepwalking draft) before making the legacy device-ID API read-only or retiring it. Scales' device-ID authentication also needs a coordinated account migration. The old identifiers remain bearer capabilities until then.
3. Decide the public AI funding/delegation model before inviting other people to use AI. Memory-only BYOK reduces retention but does not eliminate exposure to compromised frontend code.
4. Add account/songbook deletion with a documented backup-retention window, and choose an operational alert destination. No emails are collected merely to provide alerting or member labels.
