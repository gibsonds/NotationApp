# Multi-book invitations (draft, default off)

This work is separate from PR #215 (My Songs/account display). It has not been
released. The live catalog, Jon's identity and his intended book set have not
been inspected or changed. Synthetic names in the preview are not evidence
that a corresponding live, appropriately scoped book exists.

## Try the local preview on this Mac

Use Node 22, run `npm ci` and `npm ci --prefix infra`, then
`npm run preview:invitations` from this checkout. It prints
`http://127.0.0.1:4319`. This loopback URL works on this Mac, not an iPhone.
The server binds only to loopback, never reads .env files, and refuses foreign
origins/hosts. Ctrl+C stops it. State resets when the process restarts.

1. Click **Share songbooks**. Select TestBook and the two synthetic band books.
   Leave **Personal — do not share** unchecked.
2. Enter **tester@example.test**, then **Review selected books**. Check the exact
   names and per-book roles (Viewer by default), then choose **Send one invitation**.
3. Click **Done**, **Open mock mailbox**, and **Open invitation as new visitor**.
   **Continue to sign in** simulates account creation/sign-in locally. Review
   the names and choose **Join selected songbooks** once.

The simulated-session selector also demonstrates an existing user with editor
access to TestBook, an already-entitled member, and a wrong recipient. Reset
before testing another recipient because acceptance binds to the first subject.
The mailbox, sign-in and all data are mock-only. No real email is sent, even if
an actual-looking address is entered. No song content is loaded or modified.
The UI components and transaction engine are the application code; the in-memory
adapter is not a full DynamoDB emulator. Unit tests additionally cover transaction
races/failures. The actual-engine preflight script is
`DDB_ENDPOINT=http://127.0.0.1:<port> npm run test:invitations-local`; it refuses
non-loopback endpoints and creates/deletes only a random synthetic local table.
Actual-engine validation now passes against checksum-verified official DynamoDB
Local 3.3.2. The earlier native SQLite failure was resolved by explicitly naming
the bundled ARM64 library, rather than relying on its default filename:

```
-Dorg.sqlite.lib.path=/opt/ddb/DynamoDBLocal_lib
-Dorg.sqlite.lib.name=libsqlite4java-linux-aarch64.so
```

The archive was mounted read-only into the existing container Java runtime;
DynamoDB ran in memory on a loopback-only random port with dummy credentials.
The script created/deleted only its random local table. It validated actual
transaction expressions, new mixed and all-Editor grants in both membership
mirrors, existing Viewer preservation, wrong-mailbox rejection, expiration,
receipt retries, delivery claims, creator acceptance, and a removal-tombstone
transaction failure that left neither membership nor acceptance receipt written.
This clears the local database-engine blocker, but does not validate live OAuth,
Brevo delivery, deployed infrastructure, or the real book/recipient scope.

## Supported behavior

- Owners explicitly select 1–10 books and independently choose Viewer or Editor
  for each (Viewer by default), then review the frozen book/role pairs before issuance. No implicit inclusion of other books or song copying.
- A private bearer link is usable by one subject. Email mode binds the grant to
  an authenticated **verified** intended mailbox and then the accepting subject.
  Private links do not establish the recipient's mailbox identity; share privately.
- Signed-out visitors use the existing single OAuth entry. No provider-specific
  signup URL or account-existence lookup is invented. Account creation guidance
  refers only to an option offered by that hosted screen; if unavailable, the
  owner/provider setup needs review. No claim is made about Google/Apple/code.
- After sign-in the recipient sees the exact selected names and roles, accepts
  once, then opens the first selected book (stable book-ID order). All books
  appear in their normal picker. Existing owner/editor/viewer rights are kept;
  an all-member recipient with matching roles goes straight through without another grant.
  If an existing role differs from the offered role, the landing explicitly shows
  both and requires **Open existing songbooks** so the distinction is visible.
  An existing Viewer offered Editor stays Viewer; this invitation never changes
  a preexisting membership. Any change to an existing member’s role needs a separate, explicitly reviewed
  access-management action, not an implicit upgrade during acceptance.
- Both issuance and redemption condition the transaction on the creator's
  current ownership for **every** book and unchanged book identity/name.
  Deleted/renamed books, removed rights, recipient removal tombstones and
  membership races fail the whole transaction. Membership mirrors are validated.
- Acceptance and its receipt commit atomically; retries by that same subject
  return current memberships without recreating removed access. Expired tokens
  fail even before TTL cleanup. A different subject cannot reuse a consumed link.
- Issuance retries use a creator-scoped request ID and selection fingerprint.
  Reusing it for different books, roles or recipient is rejected. Acceptance rejects
  client-supplied book/role overrides and transactionally checks the stored immutable
  book-role list. Unsupported roles, including Owner, are rejected. The API never logs tokens
  or addresses. Legacy single-book links retain their existing route/semantics.
- Email transport is claimed before calling Brevo. An ambiguous outcome is
  **unconfirmed**, with no automatic retry/resend. This favors avoiding duplicate
  emails over guaranteed delivery; it is not an exactly-once delivery guarantee.
  A request retry recovers the same link. No second verification email is sent.

## Email contract and exact release prerequisites

All of these gates remain **off/unconfigured** in the checked-in deployment:

- Lambda `MULTI_BOOK_INVITES=1` and frontend build
  `NEXT_PUBLIC_MULTI_BOOK_INVITES=1` enable the new flow. Existing UI stays on
  the legacy single-book workflow by default. New API routes require authentication.
- `VERIFIED_EMAIL_INVITES=1` opts into retaining a normalized mailbox from the
  existing verified ID token, **only** with boolean `email_verified: true`.
  Signature, issuer, audience, expiry and nonce validation remain mandatory.
  Client-supplied email, access-token profile data and stub login email never
  count as verification. Turning the gate off disables binding even in old sessions.
  Subject remains the sole account/membership key. No names or method claims are added.
- Current live sign-in still requests only `openid`; that scope is unchanged.
  OAuth42 documents `email` as the scope for `email`/`email_verified`:
  <https://oauth42.com/docs/oidc>. A separately approved provider/client and minimal
  scope review, verified claim observation in a controlled nonproduction session,
  and fresh sign-in are needed before real email-bound invitations can work.
  This PR does not enable scopes, modify provider settings or retain raw tokens.
- Brevo requires an existing readable secret selected by `BREVO_INVITE_SECRET_ID`
  with `{apiKey,sender,origin}`. Sender must be verified with the provider and
  origin must be an exact allowed HTTPS app origin. Missing/unreadable/invalid
  configuration fails **before issuance or sending**. No secret, IAM grant or
  deployment environment change is included. Synthetic preview injects mock
  verified identities and mock transport instead.
- Optional mailbox data is retained only in opted-in server sessions/invitations
  (12-hour session / 48-hour invitation plus DynamoDB TTL cleanup delay). Request
  fingerprints are SHA-256 digests, not copied addresses, retained for seven days
  for idempotency. Mailboxes are never returned to invitation visitors. Domain
  case is normalized; local-part case, dots and plus aliases are not conflated.
- Before any invitation to Jon: verify the intended recipient and authoritative
  live book contents. Collision Storm and JonSaxon must be in explicitly approved
  books that do not expose a mixed personal/unreleased catalog. No grant or send
  is authorized by running this preview. Normal review, cloud preflight and
  separate release/send approvals remain outstanding.


## Mixed-role preview checks

Select two books, set one to Editor and leave the other Viewer, then review before
issuing. The recipient landing and mock message list the offered role beside each
book. New members receive exactly those book-level roles in both membership mirrors;
existing members retain their actual current access, and that difference is shown.
Editor uses the existing add/change-song and named-revision permissions. Viewer
reads songs. Neither is Owner; neither manages members, issues invites, deletes
songs or transfers ownership. There are no per-chart permissions.

The running representative Mac-only fixture overlay remains outside this PR:
The Give and Collision Storm are synthetic stand-ins, Personal is an unselected
negative control, and JonSaxon is a clearly labelled fake chart. The overlay's
local edit demonstration enforces the resulting book role against in-memory data;
it is not the production chart editor, data or a real grant to Jon. Its test
confirmation explicitly says no email was sent. Refresh/reset the preview after
an update because its in-memory invitations are cleared on restart.
