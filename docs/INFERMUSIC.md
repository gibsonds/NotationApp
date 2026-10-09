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
3. Update the OAuth42 app registration to allow the exact callback `https://charts.infermusic.ai/`. Keep `https://d1ptfjofjtkwqr.cloudfront.net/` during transition. OAuth42's current redirect bug is with Chad; no successful authenticated migration has been claimed.
4. Deploy **only** `InferMusic` and `NotationAuth` with both CDK context values:
   - `infermusicHostedZoneId=Z0255034BY58BRDL447S`
   - `infermusicCertificateArn=<issued certificate ARN>`
5. Preserve the deployed NotationAuth Lambda's existing `OAUTH_*` environment when deploying that stack. Its current CDK source reads those values at synth time; never deploy it with an empty client secret. Obtain them directly into the deployment process environment without printing them or putting them on command lines.
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

- Charts: sign in and sync the same account/songbook. Legacy GitHub Pages songs can be copied using the authenticated app's import flow once OAuth42 works.
- Scales: on the old site open **Diary → Devices**, copy the device ID, then use **Switch to another device's data** in the new site's Devices panel. The existing cloud diary remains in the same backend. Do this before logging new practice sessions in the new origin.

Shared branding does not currently imply shared authentication: Charts uses OAuth42; Scales continues to use its existing device-based diary sync.
