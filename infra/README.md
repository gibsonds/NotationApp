# NotationApp Infra (AWS CDK)

Serverless backend for the cloud-synced "My Songs" bank.

- **DynamoDB** single-table (`NotationApp`) with `pk` / `sk` and a sparse `gsi1` reserved for shared annotations
- **Lambda** (Node.js 20) — single multiplexed handler in `lambda/handler.ts`
- **API Gateway HTTP API** — `GET/PUT/DELETE /songs[/{id}]`, CORS scoped to `https://gibsonds.github.io` and `http://localhost:3000`

Account `637423285747`, region `us-east-1`.

## First-time setup

```bash
cd infra
npm install
npx cdk bootstrap aws://637423285747/us-east-1
```

`bootstrap` is a one-time per-account-per-region step that creates a `CDKToolkit` stack and a small S3 staging bucket.

## Deploy

```bash
npm run deploy
```

Outputs land in `../cdk-outputs.json`. Copy `NotationProd.ApiUrl` into:

- `.env.local` at the repo root (for local dev): `NEXT_PUBLIC_API_BASE=<value>`
- The GitHub repo variable `NEXT_PUBLIC_API_BASE` (for the Pages build)

The API URL is stable across deploys — only changes if the `HttpApi` construct is replaced.

## Other commands

```bash
npm run diff        # what would change vs deployed
npm run synth       # render CloudFormation locally
npm run destroy     # tear it all down (table is RETAIN — must be deleted manually if you want it gone)
```

## Identity model

Every request must carry `X-Device-Id: <uuid>`. The Lambda uses `DEVICE#<id>` as the DynamoDB partition key. When Cognito lands, a `/claim-device` endpoint will rewrite items to `USER#<sub>` for that device on first sign-in.
