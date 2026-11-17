# Dependency security review

## Baseline

On 2026-11-17, npm audit --omit=dev reported 62 findings: 6 critical, 23 high, 22 moderate and 11 low. This describes the installed lockfile dependency tree, not demonstrated exploitable production paths. The complete advisory output is kept outside the repository because it is reproducible and changes over time.

| Critical package | Dependency | Remediation status |
| --- | --- | --- |
| decompress | Transitive | Available according to audit |
| fast-xml-parser | Transitive | Available according to audit |
| form-data | Transitive | Available according to audit |
| proxy-addr | Transitive | Available according to audit |
| simple-git | Transitive | Available according to audit |
| tar | Transitive | Available according to audit |

## Release gate

Trace the critical and high dependency chains into the actual Lambda package and reachable request paths. Remove deployment/build packages from runtime archives where feasible. Upgrade remaining vulnerable runtime packages with focused adapter and integration tests; avoid an unreviewed force upgrade. Regenerate the lockfile and repeat the audit. Document any remaining advisory with its affected path, mitigation and owner before store readiness. Native attestation does not address vulnerable server dependencies.
