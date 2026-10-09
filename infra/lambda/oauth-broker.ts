/**
 * OAuth code-exchange broker.
 *
 * OAuth42's discovery doc advertises only secret-based token_endpoint auth
 * methods (no "none"), and the static frontend cannot hold a secret. These
 * two endpoints perform the token calls server-side with the client secret
 * from Secrets Manager, while PKCE stays enforced end-to-end (the browser keeps
 * the verifier; we just forward it). If OAuth42 later supports public
 * clients, the frontend can talk to the IdP directly and this file goes.
 *
 * Deliberately unauthenticated: these routes are how a session begins.
 * Token responses stay inside the backend; the handler creates an opaque cookie.
 */

import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
const secrets = new SecretsManagerClient({});
let cachedSecret: Promise<string> | undefined;
const ISSUER = () => process.env.OAUTH_ISSUER ?? "";
const CLIENT_ID = () => process.env.OAUTH_CLIENT_ID ?? "";
async function clientSecret(): Promise<string> {
  const id = process.env.OAUTH_CLIENT_SECRET_ID;
  if (!id) throw new Error("OAuth secret reference not configured");
  if (!cachedSecret) cachedSecret = secrets.send(new GetSecretValueCommand({ SecretId: id })).then(out => {
    if (!out.SecretString) throw new Error("OAuth secret unavailable");
    return out.SecretString;
  }).catch(err => { cachedSecret = undefined; throw err; });
  return cachedSecret;
}

export interface TokenResponse {
  status: number;
  body: Record<string, unknown>;
}

async function tokenCall(params: Record<string, string>): Promise<TokenResponse> {
  const secret = await clientSecret();
  const form = new URLSearchParams({
    ...params,
    client_id: CLIENT_ID(),
    client_secret: secret,
  });
  const res = await fetch(`${ISSUER()}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    signal: AbortSignal.timeout(10_000),
  });
  let body: Record<string, unknown>;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = { error: "invalid_idp_response" };
  }
  // Never proxy 5xx bodies through verbatim — normalize.
  if (res.status >= 500) return { status: 502, body: { error: "idp_unavailable" } };
  return { status: res.status, body };
}

export async function exchangeCode(input: {
  code: string;
  code_verifier: string;
  redirect_uri: string;
}): Promise<TokenResponse> {
  if (!ISSUER() || !CLIENT_ID()) {
    return { status: 501, body: { error: "oauth not configured" } };
  }
  return tokenCall({
    grant_type: "authorization_code",
    code: input.code,
    code_verifier: input.code_verifier,
    redirect_uri: input.redirect_uri,
  });
}

export async function refreshToken(input: {
  refresh_token: string;
}): Promise<TokenResponse> {
  if (!ISSUER() || !CLIENT_ID()) {
    return { status: 501, body: { error: "oauth not configured" } };
  }
  return tokenCall({
    grant_type: "refresh_token",
    refresh_token: input.refresh_token,
  });
}
