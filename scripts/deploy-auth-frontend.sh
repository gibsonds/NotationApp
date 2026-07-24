#!/usr/bin/env bash
# Build and deploy the AUTHENTICATED instance's static frontend to its
# S3 bucket + CloudFront distribution (stack NotationAuth).
#
# The legacy Pages instance is untouched by this — it deploys via the
# GitHub workflow as before.
#
# Reads stack outputs from cdk-outputs.json when present, else queries
# CloudFormation. Requires: aws cli creds, and the two OAuth vars.
#
# Usage:
#   NEXT_PUBLIC_OAUTH_CLIENT_ID=<id> ./scripts/deploy-auth-frontend.sh
set -euo pipefail
cd "$(dirname "$0")/.."

STACK=NotationAuth

get_output() {
  aws cloudformation describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

API_URL=$(get_output ApiUrl)
BUCKET=$(get_output SiteBucketName)
DIST_ID=$(get_output DistributionId)
SITE_URL=$(get_output SiteUrl)

: "${NEXT_PUBLIC_OAUTH_CLIENT_ID:?set NEXT_PUBLIC_OAUTH_CLIENT_ID (from the OAuth42 portal registration)}"
OAUTH_ISSUER="${NEXT_PUBLIC_OAUTH_ISSUER:-https://api.oauth42.com}"

echo "Building instance-B frontend (api=$API_URL, issuer=$OAUTH_ISSUER)"
rm -rf out

# Static export can't include the server API routes (same reason the Pages
# workflow rm -rf's them on CI). Stash them locally and ALWAYS restore.
API_STASH=$(mktemp -d)
mv src/app/api "$API_STASH/api"
trap 'mv "$API_STASH/api" src/app/api; rmdir "$API_STASH"' EXIT

# BASE_PATH="" → served at the CloudFront root (no /NotationApp prefix).
STATIC_EXPORT=1 BASE_PATH="" \
  NEXT_PUBLIC_API_BASE="$API_URL" \
  NEXT_PUBLIC_OAUTH_ISSUER="$OAUTH_ISSUER" \
  NEXT_PUBLIC_OAUTH_CLIENT_ID="$NEXT_PUBLIC_OAUTH_CLIENT_ID" \
  npx next build

echo "Syncing to s3://$BUCKET"
aws s3 sync out "s3://$BUCKET" --delete

echo "Invalidating CloudFront $DIST_ID"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" >/dev/null

echo "Deployed: $SITE_URL"
