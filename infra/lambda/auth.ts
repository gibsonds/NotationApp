/**
 * Bearer-token verification for the authenticated API.
 *
 * Instance B has no anonymous mode: every data route requires a valid
 * OAuth42-issued RS256 JWT. Verification is in-Lambda (jose + remote
 * JWKS) rather than an API Gateway authorizer so the decision logic is
 * unit-testable and the /oauth broker + stub mode share one gate.
 *
 * AUTH_STUB=1 (accepted ONLY when NODE_ENV=development, i.e. the docker
 * dev environment — never set in the CDK stack) lets local e2e tests
 * mint identities without the IdP: `Bearer stub:<sub>[:email]`.
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export interface AuthedUser {
  sub: string;
  email?: string;
  name?: string;
}

export class AuthError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "AuthError";
  }
}

type VerifyFn = (
  token: string
) => Promise<{ payload: Record<string, unknown> }>;

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

/** OAuth42 access-token profile. ID tokens omit jti; service tokens have typ. */
export async function verifyAccessToken(token: string, key?: JWTVerifyGetKey) {
  const issuer = process.env.OAUTH_ISSUER;
  const audience = process.env.OAUTH_AUDIENCE;
  if (!issuer || !audience) throw new AuthError(503, "authentication not configured");
  if (!key && !jwks) jwks = createRemoteJWKSet(new URL(process.env.OAUTH_JWKS_URL ?? `${issuer}/.well-known/jwks.json`));
  const result = await jwtVerify(token, key ?? jwks!, {
    issuer, audience, algorithms: ["RS256"], clockTolerance: 60,
    requiredClaims: ["sub", "iss", "aud", "exp", "iat", "jti"],
  });
  if (typeof result.payload.jti !== "string" || !result.payload.jti || result.payload.typ === "service_account" || result.payload.typ === "client") {
    throw new AuthError(401, "user access token required");
  }
  return result;
}
const joseVerify: VerifyFn = verifyAccessToken;

/** Pure decision core — exported for unit tests with a stubbed verifier. */
export async function resolveUserFromHeaders(
  headers: Record<string, string | undefined>,
  env: { AUTH_STUB?: string; NODE_ENV?: string },
  verify: VerifyFn
): Promise<AuthedUser> {
  const raw = headers["authorization"] ?? headers["Authorization"];
  if (!raw || !raw.toLowerCase().startsWith("bearer ")) {
    throw new AuthError(401, "missing bearer token");
  }
  const token = raw.slice(7).trim();
  if (!token) throw new AuthError(401, "missing bearer token");

  if (env.AUTH_STUB === "1" && env.NODE_ENV === "development") {
    if (token.startsWith("stub:")) {
      const [, sub, email] = token.split(":");
      if (!sub) throw new AuthError(401, "stub token missing sub");
      return { sub, ...(email ? { email } : {}) };
    }
    // fall through — a real token still verifies in stub-enabled envs
  }

  try {
    const { payload } = await verify(token);
    const sub = payload.sub;
    if (typeof sub !== "string" || !sub) {
      throw new AuthError(401, "token missing sub");
    }
    return {
      sub,

    };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError(401, "invalid token");
  }
}

/** Lambda entry: verify the event's bearer token or throw AuthError(401). */
export async function requireUser(headers: {
  [name: string]: string | undefined;
}): Promise<AuthedUser> {
  return resolveUserFromHeaders(
    headers,
    { AUTH_STUB: process.env.AUTH_STUB, NODE_ENV: process.env.NODE_ENV },
    joseVerify
  );
}
