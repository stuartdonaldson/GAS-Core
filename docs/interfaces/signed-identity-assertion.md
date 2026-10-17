# Interface: Signed Identity Assertion

**Status:** Estate-wide contract, owned by GAS-Core. Promoted from
`NUUC-Dispatch/docs/interfaces/signed-identity-assertion.md` (NUUC-Dispatch ADR-0002 Accepted
2026-07-24; ADR-0003 for the 45-day TTL). GAS-Core-na8.

The contract between the broker (NUUC-Dispatch, the issuer) and target applications (verifiers).
The canonical verifier is [`libs/LibIdentity/libIdentity.js`](../../libs/LibIdentity/libIdentity.js)
(`LibIdentity_verify`). Target apps consume it; they do not re-implement or copy-edit it.

## Wire format

JWT-compatible: `base64url(header) . base64url(payload) . base64url(signature)`,
signature = HMAC-SHA256 over `header.payload` with the per-target secret.

### Header

| Field | Value |
|-------|-------|
| `alg` | `"HS256"` |
| `typ` | `"JWT"` |
| `kid` | Name of the Script Property holding the secret (e.g. `ASSERTION_KEY_GACTIONSHEET_1`) |

### Payload claims

| Claim | Meaning |
|-------|---------|
| `iss` | `"nuuc-dispatch"` |
| `sub` | Google immutable account id of the verified visitor |
| `email` | Verified email at issue time (informational -- key on `sub`) |
| `email_verified` | From the underlying Google ID token |
| `aud` | Target application identifier the assertion is scoped to (e.g. `"gactionsheet"`) |
| `iat` | Issue time (Unix seconds) |
| `exp` | `iat + 3888000` -- **45-day TTL** |

## Issue flow (broker)

The page's verify request names the desired target `aud`; on successful Google ID-token
verification the broker's response carries the verification result **and** the signed assertion.
The broker holds no state. Issuing is not part of LibIdentity: the broker keeps `Assertion_issue`
and the `aud -> kid` registry (`ASSERTION_TARGETS`).

Caching: the page persists the returned `{assertion, exp}` in browser storage and reuses it for
every request until `exp` approaches. Renewal: once expired or near expiry, the page re-obtains a
Google ID token and repeats the call. No refresh token exists -- the assertion is the only session
artifact.

## Verifier obligations (target application)

Implemented by `LibIdentity_verify(jwt, expectedAud, { targets, failure, issuer?, nowSeconds? })`:

- **Pin the kid.** The expected `kid` comes from the verifier's own `aud -> kid` registry
  (`targets`). A token whose header `kid` differs is rejected (`bad_kid`) *before* any Script
  Property read. The verifier never looks a key up by the token's `kid`: otherwise any Script
  Property with a known value (e.g. `WEBAPP_URL`) becomes a signing key and the verifier is
  forgeable. An unregistered expected `aud` is rejected (`unknown_aud`).
- Recompute HMAC-SHA256 over `header.payload` with the secret under the pinned `kid`; compare in
  constant time. Missing secret -> `unknown_kid`; `alg` != `HS256` -> `bad_alg`.
- Verify `iss`, `aud` (must equal the target's own identifier), numeric `exp`, and that `sub` and
  `email` are non-empty strings.
- **Failure posture is declared**, via the required option `failure`:
  - `'deny'`: every rejection returns `{valid:false, reason}`; never throws.
  - `'throw'`: every rejection throws `LibIdentityError` (with `.reason`).
  - Undeclared or unknown value is a configuration error (`bad_config`) and throws. No posture
    admits an unverified token; callers do not invert semantics.
- Key identity on `sub`, not `email`.
- Authorization is entirely the verifier's responsibility -- the assertion proves *who*, never
  *what*. The verifier's per-request access check (e.g. Drive ACL) remains the live revocation
  point.
- Never log the assertion or the secret.

Reason codes: `malformed`, `bad_alg`, `unknown_aud`, `bad_kid`, `unknown_kid`, `bad_signature`,
`bad_iss`, `bad_aud`, `expired`, `missing_identity`, `verify_error`, `bad_config`.

## Key management

- One secret per target, minted by the broker operator (>= 32 random bytes, base64-encoded),
  stored in Script Properties on **both** sides under the `kid` name. The property string
  **itself** is the HMAC key (UTF-8) -- it is not base64-decoded before use.
- Rotation: add the new `kid` secret to both sides -> issuer switches to the new `kid` -> retire
  the old `kid` at the target after one TTL (45 days).

## Limits of this design

1. **Symmetric key: a target can mint for itself.** Every target holds the HMAC secret that
   verifies its assertions, so a target (or anyone who reads its Script Properties) can mint a
   valid assertion for its own `aud` with any `sub`/`email`. The `aud` scoping and kid pinning
   stop a compromised target from forging assertions for *other* targets, not for itself.
   Acceptable inside one owner's estate; do not use it where a target is not trusted to assert
   identity to itself.
2. **No revocation before `exp`.** An issued assertion is valid for its full 45 days. The only
   levers are rotating the target's `kid` secret (invalidates every session for that app at once)
   and the verifier's live per-request access check. Pair a shorter TTL with any tier that can
   destroy data.
3. **Upgrade path: RS256 + JWKS.** If either limit becomes unacceptable: the broker signs with an
   RS256 private key it alone holds and publishes the public keys at a JWKS route; targets verify
   with the public key and hold no signing capability (removing limit 1), and a short TTL plus
   refresh becomes practical (mitigating limit 2). This is a breaking wire change (`alg`, key
   source); it would ship as a new LibIdentity major version with an overlap period in which
   targets accept both algorithms per `kid`.
