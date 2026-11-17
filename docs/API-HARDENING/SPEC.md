# API hardening review contract

## Provenance

This is a retrospective review contract recorded by Codex on 2026-11-17 from the approved conversation and implemented scope. It is not a pre-implementation approved Nightshift specification. The implementation baseline is ace8123; the reviewed head before review artifacts is 8460a47. No spec-adversarial approval or sealed RED-phase test history is asserted.

## Acceptance Criteria

1. Each valid signed session has a configurable request allowance shared across AI actions.
2. Both legacy challenge and session requests share a configurable per-IP UTC-minute allowance.
3. All applicable counters and replay receipts are committed atomically before inference.
4. A disabled service rejects new session grants and inference before verification or quota storage.
5. Existing origin binding, expiry, replay protection and global/hourly allowances remain enforced.
6. Older deployed function packages can initialize the guard without optional buddy modules.
7. Deployment preserves all unrelated deployed package contents, retains confidential rollback artifacts, and rejects stale function revisions.
8. Tests establish the introduced controls without paid inference.

## Guardrails

Do not claim app-only access, native attestation, installation identity, account identity, exact currency budgets, or store readiness. Do not expose credentials, session grants, private rollback configuration or raw prompt data. Do not deploy or change live resources as part of review. Record concrete residual risks with severity, confidence, location and evidence. Report missing sealed test history accurately.

## Files to Change

This table identifies implemented review scope, not authorization to edit during the review.

| File | Scope |
| --- | --- |
| `src/security.ts` | Guard configuration, validation and transactional quotas |
| `test/security.test.cjs` | Guard and compatibility tests |
| `serverless.yml` | Deployment environment defaults |
| `env.example` | Environment documentation |
| `scripts/deploy-security-guard.py` | Narrow production guard deployment |
| `API-PROTECTION.md` | Implemented boundaries and remaining work |
| `SECURITY-DEPLOYMENT.md` | Operational contract |
| `DEPENDENCY-SECURITY-REVIEW.md` | Dependency review gate |

## Sources

All source locations are repository files at reviewed commit 8460a47; the source diff begins at ace8123. Exact finding locations are recorded in REVIEW.md. This retrospective contract is used by the post-implementation review only and does not satisfy the separate spec-claim-verification provenance gate.
