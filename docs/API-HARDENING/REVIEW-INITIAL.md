## Code Review (nightshift-review)

**Task:** API-HARDENING
**Date:** 2026-11-17
**Mode:** post-impl
**Scope:** 8 implementation/documentation files, ace8123..8460a47
**Reviewer:** Codex active runtime plus independent fresh Codex adversarial reviewer
**Contract:** Retrospective SPEC.md; not a pre-implementation spec-adversarial approval.
**TDD integrity:** SKIPPED — no lock SHAs recorded. Existing passing tests do not establish sealed RED-phase provenance.

### DRY

No blocking findings. Default values are repeated in deployment configuration and examples; consistency checks would reduce future drift (NOTE, LOW, serverless.yml:18).

### SOLID

| Severity | Confidence | Principle | Finding | Location |
| --- | --- | --- | --- | --- |
| WARN | HIGH | Dependency isolation | Deployment success checks only infrastructure status/hash; it never invokes the handler or uses a canary, so missing-import failures can pass the release check across all six concurrent targets. The earlier missing-module incident demonstrates this failure mode. | scripts/deploy-security-guard.py:49 |

### ACID

| Severity | Confidence | Property | Finding | Location |
| --- | --- | --- | --- | --- |
| BLOCK | HIGH | Consistency/isolation | Reusing a backup directory patches the cached old archive while obtaining the latest deployed RevisionId. An intervening unrelated release is silently overwritten; optimistic concurrency checks accept the overwrite because they are tied to current metadata rather than the actual package preimage. | scripts/deploy-security-guard.py:25 |
| WARN | HIGH | Confidentiality/durability | Existing backup directories/files retain existing permissions and symlinks are followed. umask and mkdir(mode=0700,exist_ok=True) do not secure an existing permissive directory or existing files before secret-bearing configuration is written. | scripts/deploy-security-guard.py:18 |

Quota transaction review found no concrete introduced bypass: session validation precedes the session counter; minute, session, global and hourly counters share the replay receipt's conditional transaction. The session counter lifetime exceeds the grant lifetime. Per-session renewal, legacy direct challenges, shared-IP fairness and fixed-window boundaries are documented limitations rather than an installation/account guarantee.

### CoC

| Severity | Confidence | Finding | Location |
| --- | --- | --- | --- |
| WARN | HIGH | Production account, runtime, package-presence and hash checks use Python assert; optimized Python removes these safety checks. Use explicit exceptions and test the optimized invocation. | scripts/deploy-security-guard.py:14 |

### Big O

No findings. Request size and transaction item count remain bounded. The deployment loop covers six known functions outside the request hot path.

### LLM Trust Boundary

No introduced model-to-execution, SQL, redirect or HTML path found. Conditional require targets are fixed literals, not caller-controlled module names. Optional modules are reached only by the supported mode branches. Existing external moderation, accounts and model provider boundaries require their separate reviews.

### Evidence

- npm run test:security: 66 passed, 0 failed. All verification/quota dependencies in this suite are isolated; no paid inference was performed.
- Offline deployment reproduction: six cached archives contain OLD handler; mocked deployed metadata contains NEW handler and current revision; all six outgoing archives contain OLD handler and the script reports Successful. No AWS calls were made.
- Python AST identifies assertions at lines 14, 23, 28, 30 and 51; these are removable under optimized execution.
- Independent reviewer confirmed the cached-preimage BLOCK and missing runtime health checks, and found no concrete new quota bypass.
- Native attestation, account/installation budgets and exact spending ceilings remain unimplemented. Existing dependency advisories are tracked separately in DEPENDENCY-SECURITY-REVIEW.md and are not evidence of an exploited path.

### Summary

- BLOCK: 1 (HIGH: 1, MEDIUM: 0)
- WARN: 3
- NOTE: 1

### Trend (vs last run)

First review for API-HARDENING — no prior review delta.

### Verdict

REQUEST CHANGES. The deployment tool must always patch a freshly fetched, verified deployed archive, keep rollback snapshots separate and immutable, and bind its optimistic revision to that preimage. Resolve the release-health, explicit-validation and private-backup warnings before reuse. Do not treat this review as approval to redeploy. Production was not changed during this review.
