# AI demo verification and usage controls

## Scope

The Lambda handler and local Express adapter require verified page access before running any of the five AI demos. A short-lived page session avoids repeating a challenge for every action. Static portfolio content and YATA playback do not use this backend gate.

## Request contract

On page load, run one managed Turnstile widget with action `page`. Send its token to `POST /session` as `{ "turnstileToken": "..." }`. The server checks the configured hostname, browser origin and API Gateway source IP, and atomically claims the challenge token once. This exchange performs no model call and consumes no inference quota. It returns `{ "sessionToken": "...", "expiresAt": 1234567890 }`, with expiry expressed in Unix seconds.

Keep `sessionToken` only in browser memory. It is a signed, 30-minute grant bound to the origin and a keyed digest of the source IP. The payload includes issuance/expiry times and a random nonce; its signature uses a context-separated HMAC key derived from the backend Turnstile secret. The raw source IP is absent. Rotating the secret invalidates outstanding grants. IP or origin changes require verification again. The token is not a user account or authorization to bypass quotas.

For each AI action, send the existing demo fields plus `sessionToken`. Chat, translation, assistant and sentiment requests require a nonempty `question`; foxtrot requires `programmingLanguage`. Invalid or expired page sessions return HTTP 401 with `{ "error": "...", "code": "verification_required" }` before quota storage or inference. Clear the grant and verify again; do not automatically retry an ambiguous paid request after a timeout or HTTP 503.

Legacy clients may still send `turnstileToken` directly to an AI route. Its widget action must match `chatbot`, `translation`, `personalAssistant`, `sentimentAnalysis`, or `foxtrot`; that challenge token remains single-use. If a request contains `sessionToken`, the session must validate even if a legacy token is also supplied.

Successful AI responses remain `{ "answer": "..." }`. Other rejected requests return `{ "error": "..." }` with an appropriate HTTP status. Responses use `Cache-Control: no-store`. Only configured browser origins receive a CORS allow-origin header. Origin checks supplement cryptographic verification; they are not authentication.

## Configuration

| Environment variable | Default or requirement |
| --- | --- |
| `OPENAI_API_KEY` | Required server secret |
| `OPENAI_MODEL` | `gpt-4o`; verify model compatibility before changing |
| `TURNSTILE_SECRET_KEY` | Required production widget secret |
| `TURNSTILE_HOSTNAMES` | `doctorew.com,www.doctorew.com` |
| `AI_ALLOWED_ORIGINS` | `https://doctorew.com,https://www.doctorew.com` |
| `AI_GUARD_TABLE` | CloudFormation table reference; required |
| `AI_ENABLED` | `true`; other supplied values stop new grants and inference |
| `AI_SESSION_LIMIT` | `30` requests per signed session |
| `AI_MINUTE_IP_LIMIT` | `10` requests per IP per UTC minute |
| `AI_DAILY_LIMIT` | `300` requests, UTC calendar day |
| `AI_MONTHLY_LIMIT` | `2000` requests, UTC calendar month |
| `AI_HOURLY_IP_LIMIT` | `60` requests, UTC calendar hour and source IP |

Use a production Turnstile widget restricted to the configured hostnames. The public site key belongs in frontend configuration; the widget secret belongs only in the backend environment. Do not commit `.env` files, secrets, resolved CloudFormation templates or deployment state. The dotenv plugin does not automatically copy unrelated environment-file variables to Lambda.

The table uses a string partition key `pk` and TTL attribute `expiresAt`. `serverless.yml` creates it with on-demand billing and retains it when the stack is deleted or replaced. The Lambda role allows `dynamodb:PutItem` and `dynamodb:UpdateItem` on that table only, restricted by `dynamodb:EnclosingOperation` to `TransactWriteItems`.

For each paid request, a single DynamoDB transaction stores a unique request receipt and increments daily, monthly, per-IP hourly and per-IP minute counters, plus a per-session counter for signed grants. Session requests use a fresh server-generated nonce for each receipt; they do not reuse the grant digest. Legacy requests use the challenge token digest, preserving single-use enforcement. Each conditional write must succeed before inference begins. No plaintext token or source IP is stored. The IP key uses an HMAC with the Turnstile secret. Failed model calls still consume quota. Counters use calendar windows rather than rolling windows. Keep the table and its counters when deploying, and avoid concurrent old and new handlers that bypass this gate.

## Limits

Requests are limited to 16 KiB JSON; questions to 4,000 characters; language and personality fields to 80 characters; Turnstile tokens and session grants to 2,048 characters. Model output is capped at 600 tokens and returned text at 12,000 characters. The model request has a 25-second timeout and no SDK retries. Verification and individual DynamoDB calls each have a five-second timeout. Explicit DynamoDB transaction-conflict cancellations receive at most two storage-only retries with short jittered delays, using the same transaction and request receipt. Failed conditions are not retried and return HTTP 429 for inference or HTTP 403 for a used page challenge. Persistent conflicts and ambiguous cancellations return HTTP 503. Network timeouts and model requests are never retried by this guard. Lambda timeout is 40 seconds.

Each function reserves two concurrent executions. The post-deployment hook applies API Gateway stage throttles of two requests per second with a burst of ten, and disables data tracing. These throttles are best-effort traffic controls; the conditional DynamoDB transaction enforces accepted inference request caps. The burst allowance covers the initial page verification and two automatic demos, including their preflight requests. Classroom users sharing an IP also share the hourly IP allowance. Limits cover this handler's AI calls, not all account charges or other API-key consumers.

## Build and release

1. Install locked dependencies with `npm ci --ignore-scripts` and run `npm run test:security`. These tests use mocked verification and quota storage and do not call OpenAI.
2. Build with `npm run build` before packaging. The Lambda entry point remains `dist/src/handler.handler`.
3. Supply production secrets through the deployment environment. Use a private workspace and `umask 077`; Serverless resolves secrets into local deployment state and templates. Never publish those artifacts. `serverless.yml` excludes environment files from the Lambda ZIP.
4. Package with the installed Serverless CLI. Its currently locked v3 schema warns that it does not recognize `nodejs24.x`; inspect the generated template to confirm all six functions use that runtime. Packaging succeeds with `NODE_OPTIONS=--no-experimental-require-module` on the current local Node 26 toolchain; without this compatibility flag the legacy CLI plugin loader fails before packaging. Use a Node 24-compatible deployment toolchain or review a toolchain upgrade before deploying.
5. Review the generated DynamoDB resource, role policy, API stage limits, function timeout and reserved concurrency. Keep the existing custom-domain mapping. Deploy backend and frontend as one coordinated release after the widget is configured; backend-first temporarily rejects older unverified clients.
6. Confirm missing/invalid verification is rejected on the session route and all five AI routes. Perform a page verification and confirm replaying its challenge token is rejected. Use the resulting session for two small AI requests; both should succeed and each must increment inference counters. Confirm an expired or tampered grant returns HTTP 401. A dummy-key packaging check does not establish production verification.

The existing `npm test` script runs `test-local.ts` and may make real model requests; use `npm run test:security` for isolated security checks. Changing the model requires checking API compatibility, actual account availability and pricing. No model change is required for these controls.

## Character behavior

Skippy uses a separate system message for both chat and translation, with concise, original, sarcastic beer-can AI instructions and occasional profanity. Short style examples calibrate the tone, and requested response length takes priority over extra banter. Translation returns a faithful translation in its own section and at most one separate short Skippy remark. User input remains a separate human message. Language and programming-language values are bound prompt variables, so literal braces are not interpreted as template placeholders. Other configured personality templates retain their existing behavior. Prompt structure tests establish this separation; live answer quality still requires a small human review.

## References

- [Cloudflare server-side token validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [DynamoDB transaction IAM permissions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis-iam.html)
- [DynamoDB table resource](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-dynamodb-table.html)
- [API Gateway deployment stage settings](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-apigateway-deployment-stagedescription.html)

## YATA channel planning

The existing `POST /chatbot` route also accepts a bounded personal-channel request. Send `mode: "channel"`, a `question` of at most 1,000 characters, a finite `host`, and `shows` containing a JSON-encoded array of offered `{id,title,channel}` descriptors. The offered list contains 1–100 entries, uses unique lowercase alphanumeric/hyphen IDs, and is limited to 12,000 characters within the existing 16 KiB request limit. Existing session verification, replay receipts and inference quotas apply unchanged. No catalog or source write operation is exposed.

Supported hosts are `stubing`, `arnold`, `jabberjaw`, `benson`, `mrt`, `murdock`, `twiki`, and `starbuck`. Arnold refers to Arnold Jackson; Starbuck refers to the original Battlestar Galactica character. The client selects a host from this finite set.

The response contains `plan` with `host`, `title` (at most 80 characters), `intro` (at most 700 characters), and `showIds` (at most 12 unique offered IDs). Empty `showIds` represents no suitable matches and must not start playback. Invalid model output returns a service error; it is never repaired into an invented catalog entry. Responses contain no sources or URLs. Clients must revalidate selected IDs against their current verified, playable catalog and display a review before tuning. Offered descriptors are caller data, not an authoritative server catalog; they confer no publication privileges.

Run `npm run test:security` to build and exercise security and planner contracts. Deployment must include the newly compiled `dist/src/channelPlanner.js` alongside the changed handler, security and personality modules. No additional API Gateway route or Lambda is required.

## Session-budget release

See [API protection implementation](API-PROTECTION.md) for the session and minute limits, emergency-stop semantics, and outstanding attestation and spending controls. The narrowly scoped release command is `python scripts/deploy-security-guard.py --backup-dir PRIVATE_DIRECTORY --apply`, after building and passing security tests. It requires boto3 and AWS credentials. It builds the guard, fetches and hashes fresh deployed archives, preserves each archive except `dist/src/security.js`, and uses matching optimistic function revisions. It stores immutable rollback archives and configuration in a unique private run directory. Every function must pass a startup/verification-denial canary before rollout proceeds. Failed rollouts reconcile attempted writes and restore verified known preimages when safe; concurrent foreign changes require operator attention. Omit `--apply` to build and prepare backups without updating functions. Existing backup directories must be owned by the current user and private; symlink directories are rejected. Never commit the backup directory; configuration backups contain secrets.
