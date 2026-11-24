#!/usr/bin/env bash
# Build only. Run in the credential-free job; never use CDK/deploy here.
set -euo pipefail
cd "$(dirname "$0")/.."
RELEASE_SHA="${1:?full reviewed commit SHA required}"
[[ "$RELEASE_SHA" =~ ^[a-f0-9]{40}$ ]] || { echo 'Full lowercase source SHA required' >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$RELEASE_SHA" ]] || { echo 'Source SHA differs from checkout' >&2; exit 1; }
git diff --quiet || { echo 'Tracked worktree is dirty' >&2; exit 1; }
git diff --cached --quiet || { echo 'Index is dirty' >&2; exit 1; }
for ENV_FILE in .env .env.local .env.production .env.production.local; do
  [[ ! -e "$ENV_FILE" ]] || { echo 'Refusing a release build with dotenv files present' >&2; exit 1; }
done
[[ ! -e release-bundle ]] || { echo 'release-bundle already exists; use a clean checkout' >&2; exit 1; }
mkdir release-bundle
BUILD_TEMP=$(mktemp -d "${RUNNER_TEMP:-/tmp}/notation-charts-build.XXXXXX")
cleanup() {
  if [[ -d "$BUILD_TEMP/api" ]]; then mv "$BUILD_TEMP/api" src/app/api; fi
  rm -rf "$BUILD_TEMP"
}
trap cleanup EXIT

./infra/node_modules/.bin/esbuild infra/lambda/handler-auth.ts --bundle --platform=node --target=node22 --format=cjs --minify --outfile="$BUILD_TEMP/index.js"
python3 - "$BUILD_TEMP/index.js" <<'PY'
import sys, zipfile
from pathlib import Path
with zipfile.ZipFile('release-bundle/backend.zip', 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    item = zipfile.ZipInfo('index.js', date_time=(1980, 1, 1, 0, 0, 0))
    item.compress_type = zipfile.ZIP_DEFLATED
    item.external_attr = 0o100644 << 16
    archive.writestr(item, Path(sys.argv[1]).read_bytes())
PY
MULTI_BOOK=$(python3 - <<'PY'
import json
from pathlib import Path
config = json.loads(Path('infra/release/charts-release-config.json').read_text())
assert type(config['multiBookInvites']) is bool
print('1' if config['multiBookInvites'] else '0')
PY
)
VERIFIED_EMAIL=$(python3 - <<'PY'
import json
from pathlib import Path
config = json.loads(Path('infra/release/charts-release-config.json').read_text())
assert type(config['verifiedEmail']) is bool
print('1' if config['verifiedEmail'] else '0')
PY
)
# Match the existing authenticated static build; restore server routes on failure.
rm -rf out .next/dev/types
mv src/app/api "$BUILD_TEMP/api"
STATIC_EXPORT=1 BASE_PATH="" NEXT_PUBLIC_API_BASE="/auth-api" \
NEXT_PUBLIC_COOKIE_SESSIONS=1 NEXT_PUBLIC_MULTI_BOOK_INVITES="$MULTI_BOOK" \
NEXT_PUBLIC_VERIFIED_EMAIL_INVITES="$VERIFIED_EMAIL" \
NEXT_PUBLIC_SUITE_HOME="https://app.collisionstorm.com" \
NEXT_PUBLIC_OAUTH_ISSUER="https://api.oauth42.com" \
NEXT_PUBLIC_OAUTH_CLIENT_ID="oauth42_app_ce567578a0c9471dbb6f2cdec36b91f4" \
./node_modules/.bin/next build --webpack
node scripts/harden-static.mjs out
cp -R out release-bundle/out
mv "$BUILD_TEMP/api" src/app/api
git diff --quiet || { echo 'Build modified tracked files' >&2; exit 1; }
git diff --cached --quiet || { echo 'Build modified the index' >&2; exit 1; }
python3 scripts/charts_release.py manifest --sha "$RELEASE_SHA"
python3 scripts/charts_release.py validate --sha "$RELEASE_SHA"
