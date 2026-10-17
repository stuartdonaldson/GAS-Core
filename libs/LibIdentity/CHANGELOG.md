# LibIdentity Changelog

## v1.0.0 -- unreleased (tag libidentity-v1.0.0 pending)

Initial canonical version. `LibIdentity_verify` extracted from
`NUUC-Dispatch/src/Assertion.js` `Assertion_verify` (the brokered-identity
verifier; GAS-Core-na8). Not the direct per-app tokeninfo verifier.

Differences from the NUUC-Dispatch reference it replaces:
- Registry (`targets`) and failure posture (`failure: 'deny'|'throw'`) are
  explicit options; posture is required, never defaulted.
- Requires non-empty string `sub` and `email` (reference returned them unchecked;
  GActionSheet's copy already required both). Reason `missing_identity`.
- Unexpected runtime errors during verification deny (`verify_error`) instead of
  escaping.
