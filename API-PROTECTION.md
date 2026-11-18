# API protection implementation

## Status

The first implementation adds per-session inference allowances, fixed-window per-IP minute limits, and an emergency stop. The runtime guard was deployed and negative-tested on 2026-11-17. Deployment-tool repairs were subsequently reviewed offline; they do not change the running API. Compiled defaults supply the deployed session and minute allowances; existing global/hourly environment settings were preserved.

## Request controls

| Setting | Default | Behavior |
| --- | --- | --- |
| AI_ENABLED | true | Any value other than the literal true disables session creation and inference before external verification or quota storage. Omission retains compatibility. |
| AI_SESSION_LIMIT | 30 | Maximum authorized requests per signed 30-minute session, shared across actions. |
| AI_MINUTE_IP_LIMIT | 10 | Maximum authorized requests per IP per UTC minute, including direct challenge requests. |

Existing hourly IP, daily global, monthly global, and replay controls remain enforced. All applicable counters and the receipt are written in one DynamoDB transaction before inference. Conditional rejection returns HTTP 429. Storage errors fail closed. Fixed windows can permit traffic on both sides of a minute boundary; this is a burst reduction, not a strict rolling-window guarantee.

The session counter uses an HMAC of the complete validated signed grant. Its lifetime exceeds the grant lifetime; enforcement does not depend on prompt TTL deletion. Tokens and raw IP addresses are not stored in counter keys. A new grant receives a new session allowance, but retains the shared IP and global limits.

The existing deployment configuration reserves two concurrent executions per function. This is not a per-user or aggregate cross-function concurrency limit.

## Operational procedure

Deploy the source and environment configuration together. Set AI_ENABLED=false to stop new session grants and inference. Verify denial without invoking the model, then restore true to resume. This switch does not cancel work already executing. Changing process configuration requires a Lambda configuration rollout; it is not an instantaneous external switch.

Do not raise global limits when introducing session quotas. Review observed rejected requests before tuning. Shared networks can reach IP limits collectively.

## Remaining work before store release

1. Verify deployed limits and provide a reproducible release and rollback procedure.
2. Add server-verified native attestation with request binding. Preserve a separately constrained sideload testing path; do not introduce an embedded app secret.
3. Establish authenticated account and installation budgets where needed. A session is not an installation or a user identity.
4. Add weighted input/output cost reservations and an enforced aggregate spending allowance. Request caps are not exact currency caps.
5. Add abuse metrics without logging session tokens, raw prompts, or secret configuration.
6. Exercise the deployed rejection path and compatibility with web and native clients.

Public catalog reads remain separate from paid inference authorization. Administrative publication requires independent credentials. Origin checks and CORS do not authenticate an app.

## Validation

npm run test:security builds TypeScript and runs the security suite. Tests cover emergency denial before external work, shared action allowances, independent grants, transactional failure behavior, minute windows, replay, malformed requests, expired grants, and storage outages. These are local tests; they do not establish production enforcement or real DynamoDB concurrency behavior.

## Deployment-tool review resolution

The tool always fetches the current archive and binds its verified hash to the same lookup as its optimistic revision. Rollback archives are immutable, separate snapshots inside a fresh private run directory; they never become release preimages. Existing permissive backup directories and symlink targets are rejected. Safety checks use explicit failures, including under optimized Python.

Rollout is sequential with the session function first. Each function must initialize and deny missing verification before continuing. Failure reconciles attempted mutations, including an accepted update with a lost response. Recovery restores only the known postimage, checks revisions, and verifies restored denial behavior. Foreign concurrent releases and uncertain rollback outcomes require attention instead of a false success report. Negative smoke checks establish startup and verification denial, not successful paid inference or full application behavior.
