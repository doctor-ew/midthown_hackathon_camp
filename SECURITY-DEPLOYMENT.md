# AI demo verification and usage controls

## Scope

The Lambda handler and local Express adapter require a server-validated Turnstile token before running any of the five AI demos. Static portfolio content and YATA playback do not use this backend gate.

## Request contract

Send a JSON POST with the existing demo fields and `turnstileToken`. The Turnstile widget action must match the route: `chatbot`, `translation`, `personalAssistant`, `sentimentAnalysis`, or `foxtrot`. Tokens cannot be shared across actions or reused. Chat, translation, assistant and sentiment requests require a nonempty `question`; foxtrot requires `programmingLanguage`.

Successful responses remain `{ "answer": "..." }`. Rejected requests return `{ "error": "..." }` with an appropriate HTTP status. Responses use `Cache-Control: no-store`. Only configured browser origins receive a CORS allow-origin header. Origin checks supplement Turnstile; they are not authentication.

## Configuration

| Environment variable | Default or requirement |
| --- | --- |
| `OPENAI_API_KEY` | Required server secret |
| `OPENAI_MODEL` | `gpt-4o`; verify model compatibility before changing |
| `TURNSTILE_SECRET_KEY` | Required production widget secret |
| `TURNSTILE_HOSTNAMES` | `doctorew.com,www.doctorew.com` |
| `AI_ALLOWED_ORIGINS` | `https://doctorew.com,https://www.doctorew.com` |
| `AI_GUARD_TABLE` | CloudFormation table reference; required |
| `AI_DAILY_LIMIT` | `300` requests, UTC calendar day |
| `AI_MONTHLY_LIMIT` | `2000` requests, UTC calendar month |
| `AI_HOURLY_IP_LIMIT` | `60` requests, UTC calendar hour and source IP |

Use a production Turnstile widget restricted to the configured hostnames. The public site key belongs in frontend configuration; the widget secret belongs only in the backend environment. Do not commit `.env` files, secrets, resolved CloudFormation templates or deployment state. The dotenv plugin does not automatically copy unrelated environment-file variables to Lambda.

The table uses a string partition key `pk` and TTL attribute `expiresAt`. `serverless.yml` creates it with on-demand billing and retains it when the stack is deleted or replaced. The Lambda role allows `dynamodb:PutItem` and `dynamodb:UpdateItem` on that table only, restricted by `dynamodb:EnclosingOperation` to `TransactWriteItems`.

A single DynamoDB transaction stores a token digest and increments daily, monthly and per-IP hourly counters. Each conditional write must succeed before inference begins. No plaintext token or source IP is stored. The IP key uses an HMAC with the Turnstile secret. Failed model calls still consume quota. Counters use calendar windows rather than rolling windows. Keep the table and its counters when deploying, and avoid concurrent old and new handlers that bypass this gate.

## Limits

Requests are limited to 16 KiB JSON; questions to 4,000 characters; language and personality fields to 80 characters; Turnstile tokens to 2,048 characters. Model output is capped at 600 tokens and returned text at 12,000 characters. The model request has a 25-second timeout and no SDK retries. Verification and DynamoDB calls each have a five-second timeout. Lambda timeout is 40 seconds.

Each function reserves two concurrent executions. The post-deployment hook applies API Gateway stage throttles of two requests per second with a burst of five, and disables data tracing. These throttles are best-effort traffic controls; the conditional DynamoDB transaction enforces accepted inference request caps. Classroom users sharing an IP also share the hourly IP allowance. Limits cover this handler's AI calls, not all account charges or other API-key consumers.

## Build and release

1. Install locked dependencies with `npm ci --ignore-scripts` and run `npm run test:security`. These tests use mocked verification and quota storage and do not call OpenAI.
2. Build with `npm run build` before packaging. The Lambda entry point remains `dist/src/handler.handler`.
3. Supply production secrets through the deployment environment. Use a private workspace and `umask 077`; Serverless resolves secrets into local deployment state and templates. Never publish those artifacts. `serverless.yml` excludes environment files from the Lambda ZIP.
4. Package with the installed Serverless CLI. Its currently locked v3 schema warns that it does not recognize `nodejs24.x`; inspect the generated template to confirm all five functions use that runtime. Packaging succeeds with `NODE_OPTIONS=--no-experimental-require-module` on the current local Node 26 toolchain; without this compatibility flag the legacy CLI plugin loader fails before packaging. Use a Node 24-compatible deployment toolchain or review a toolchain upgrade before deploying.
5. Review the generated DynamoDB resource, role policy, API stage limits, function timeout and reserved concurrency. Keep the existing custom-domain mapping. Deploy backend and frontend as one coordinated release after the widget is configured; backend-first temporarily rejects older unverified clients.
6. Confirm missing/invalid tokens are rejected on all five routes. Then perform a human widget verification and one small AI request. Confirm replay is rejected and the expected quota counters increment. A dummy-key packaging check does not establish production verification.

The existing `npm test` script runs `test-local.ts` and may make real model requests; use `npm run test:security` for isolated security checks. Changing the model requires checking API compatibility, actual account availability and pricing. No model change is required for these controls.

## References

- [Cloudflare server-side token validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [DynamoDB transaction IAM permissions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis-iam.html)
- [DynamoDB table resource](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-dynamodb-table.html)
- [API Gateway deployment stage settings](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-apigateway-deployment-stagedescription.html)
