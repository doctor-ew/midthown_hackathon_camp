## Code Review (nightshift-review)

**Task:** API-HARDENING
**Date:** 2026-11-17
**Mode:** post-implementation repair review
**Reviewer:** Codex active runtime plus fresh independent adversarial review
**Contract:** Retrospective SPEC.md; no pre-implementation spec approval or sealed RED-phase provenance is asserted.

### DRY

NOTE, LOW: guard default values remain represented in deployment configuration and examples. This is unchanged and nonblocking (serverless.yml:18).

### SOLID

No remaining findings in this scope. Preparation, archive patching, private backup writes, health checks and recovery are separate injectable functions.

### ACID

No remaining blocking findings. prepare fetches current deployed bytes and verifies their hash against the same function lookup as the revision (scripts/deploy-security-guard.py:63). Backup snapshots never become deployment inputs. Exclusive private writes and fresh run directories prevent stale-cache reuse and ordinary symlink/permissive-directory failures (scripts/deploy-security-guard.py:31).

Attempted mutations are tracked before the remote call; ambiguous failures reconcile stable package state before recovery (scripts/deploy-security-guard.py:111). Recovery restores known postimages with revision checks, preserves foreign releases and reports unresolved outcomes conservatively (scripts/deploy-security-guard.py:122).

### CoC

No remaining findings. Explicit checks replace removable assertions (scripts/deploy-security-guard.py:22).

### Big O

No findings. Six known functions are processed sequentially outside the application request path. Archive memory use remains proportional to the deployed package sizes.

### LLM Trust Boundary

No introduced user/model-controlled execution path. Canary requests contain no user prompt or credentials and cannot authorize paid inference. This review does not establish native attestation, account identity or currency budgets.

### Repair history

1. Initial review: one BLOCK and three WARNs. Preserved verbatim in REVIEW-INITIAL.md.
2. First repair review: original findings repaired; independent reviewer reproduced a new BLOCK where an accepted update with a lost response escaped recovery and caused a false restoration message.
3. Second repair: track the attempt before the call, reconcile hashes and stable status, then verify restoration or report attention. Added the lost-response regression.
4. Independent reviewer reran all 11 deployment regressions and approved the latest implementation with no remaining blocking findings.

### Evidence

npm run test:security passes 66 JavaScript security tests and all 11 offline deployment tests in both normal and optimized Python. Deployment regressions use fake AWS clients and no network or paid inference. Cases cover stale backups, private/exclusive backups, symlinks, hash mismatch, optimization, sequential canaries, health rollback, stale revisions, concurrent foreign releases and accepted-update/lost-response recovery.

### Summary

- BLOCK: 0
- WARN: 0
- NOTE: 1

### Trend

Initial review: BLOCK 1 / WARN 3 / NOTE 1. Final repair review: BLOCK 0 / WARN 0 / NOTE 1. The intermediate lost-response blocker was retained in this repair history and covered by a regression.

### Verdict

APPROVE for the deployment-tool repair scope. No production resources changed during repair or review. The smoke check establishes startup and verification denial, not authenticated inference or full web/mobile behavior. Backup ancestry assumes the operator's trusted filesystem; hostile replacement of trusted ancestor directories is outside the current tool threat model. Native attestation, exact spending controls and dependency remediation remain open before store readiness.
