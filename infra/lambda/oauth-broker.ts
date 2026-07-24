/**
 * OAuth code-exchange broker.
 *
 * OAuth42's discovery doc advertises only secret-based token_endpoint auth
 * methods (no "none"), and the static frontend cannot hold a secret. These
 * two endpoints perform the token calls server-side with the client secret
 * from Lambda env, while PKCE stays enforced end-to-end (the browser keeps
 * the verifier; we just forward it). If OAuth42 later supports public
 * clients, the frontend can talk to the IdP directly and this file goes.
 *
 * Deliberately unauthenticated: these routes are how a session begins.
 * They forward to the IdP and return its response — no state stored here.
 */

const ISSUER = () => process.env.OAUTH_ISSUER ?? "";
const CLIENT_ID = () => process.env.OAUTH_CLIENT_ID ?? "";
const CLIENT_SECRET = () => process.env.OAUTH_CLIENT_SECRET ?? "";

export interface TokenResponse {
  status: number;
  body: Record<string, unknown>;
}

async function tokenCall(params: Record<string, string>): Promise<TokenResponse> {
  const form = new URLSearchParams({
    ...params,
    client_id: CLIENT_ID(),
    ...(CLIENT_SECRET() ? { client_secret: CLIENT_SECRET() } : {}),
  });
  const res = await fetch(`${ISSUER()}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
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
