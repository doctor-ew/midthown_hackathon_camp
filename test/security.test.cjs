const {test} = require('node:test');
const assert = require('node:assert/strict');
const {authorize, configuration, quotaTransaction, parseRequest, responseHeaders, ACTIONS} = require('../dist/src/security');
const config = {...configuration({}), secret: 'unit-test-only', table: 'unit-test-table'};
const event = (action = 'chatbot', patch = {}) => ({
  path: '/' + action, httpMethod: 'POST', headers: {origin: 'https://doctorew.com', 'Content-Type': 'application/json'},
  body: JSON.stringify({question: 'Hello', programmingLanguage: 'Python', turnstileToken: 'one-use-token'}),
  requestContext: {identity: {sourceIp: '192.0.2.1'}}, ...patch,
});
const dependencies = (action = 'chatbot', patch = {}) => ({
  verify: async () => ({success: true, hostname: 'doctorew.com', action}),
  transact: async () => {}, now: () => new Date('2026-11-13T12:00:00Z'), ...patch,
});
for (const action of ACTIONS) {
  test(`${action}: valid verification gates paid work`, async () => {
    let consumed = 0;
    const result = await authorize(event(action), config, dependencies(action, {transact: async () => consumed++}));
    assert.equal(result.action, action); assert.equal(consumed, 1);
  });
  test(`${action}: absent token fails before external calls`, async () => {
    await assert.rejects(authorize(event(action, {body: JSON.stringify({question: 'Hi', programmingLanguage: 'Python'})}), config,
      dependencies(action, {verify: () => {throw new Error('must not call');}})), {statusCode: 403});
  });
}
test('missing backend configuration fails closed', async () => {
  for (const patch of [{secret: ''}, {table: ''}, {origins: []}, {hostnames: []}]) {
    await assert.rejects(authorize(event(), {...config, ...patch}, dependencies()), {statusCode: 503});
  }
});
test('untrusted origin fails before verification', async () => {
  await assert.rejects(authorize(event('chatbot', {headers: {origin: 'https://evil.invalid', 'content-type': 'application/json'}}), config,
    dependencies('chatbot', {verify: () => {throw new Error('must not call');}})), {statusCode: 403});
});
test('success, hostname and matching route action all required', async () => {
  for (const result of [{success: false}, {success: true, hostname: 'evil.invalid', action: 'chatbot'},
    {success: true, hostname: 'doctorew.com', action: 'translation'}, null]) {
    await assert.rejects(authorize(event(), config, dependencies('chatbot', {verify: async () => result})), {statusCode: 403});
  }
});
test('Cloudflare outage and quota store outage fail closed', async () => {
  await assert.rejects(authorize(event(), config, dependencies('chatbot', {verify: async () => {throw new Error('offline');}})), {statusCode: 503});
  await assert.rejects(authorize(event(), config, dependencies('chatbot', {transact: async () => {throw new Error('offline');}})), {statusCode: 503});
});
test('transaction cancellation rejects replay/quota without proceeding', async () => {
  await assert.rejects(authorize(event(), config, dependencies('chatbot', {transact: async () => {
    throw Object.assign(new Error('cancelled'), {code: 'TransactionCanceledException'});
  }})), {statusCode: 429});
});
test('atomic quota transaction contains replay and all global/IP limits', () => {
  const tx = quotaTransaction(config, 'one-use-token', '192.0.2.1', new Date('2026-11-13T12:00:00Z'));
  assert.equal(tx.TransactItems.length, 4);
  assert.equal(tx.TransactItems[0].Put.ConditionExpression, 'attribute_not_exists(pk)');
  assert.deepEqual(tx.TransactItems.slice(1).map(x => x.Update.ExpressionAttributeValues[':cap']), [300, 2000, 60]);
  assert.deepEqual(tx.TransactItems.slice(1, 3).map(x => x.Update.Key.pk), ['day:2026-11-13', 'month:2026-11']);
  assert.ok(!JSON.stringify(tx).includes('one-use-token'));
  assert.ok(!JSON.stringify(tx).includes('192.0.2.1'));
  for (const item of tx.TransactItems.slice(1)) assert.equal(item.Update.ConditionExpression, 'attribute_not_exists(#used) OR #used < :cap');
});
test('concurrent valid challenges still consume one transaction per accepted token', async () => {
  const consumed = new Set();
  const deps = dependencies('chatbot', {transact: async tx => {
    const key = tx.TransactItems[0].Put.Item.pk;
    if (consumed.has(key)) throw Object.assign(new Error('duplicate'), {code: 'TransactionCanceledException'});
    consumed.add(key);
  }});
  const results = await Promise.allSettled([authorize(event(), config, deps), authorize(event(), config, deps)]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(results.find(x => x.status === 'rejected').reason.statusCode, 429);
});
test('request limits reject malformed, oversized and unsupported inputs', () => {
  for (const patch of [{body: '{'}, {body: 'null'}, {body: '[]'}, {body: 'x'.repeat(16385)},
    {isBase64Encoded: true}, {httpMethod: 'GET'}, {path: '/unknown'},
    {body: JSON.stringify({question: 'x'.repeat(4001), turnstileToken: 't'})},
    {body: JSON.stringify({question: 'hi', turnstileToken: 't'.repeat(2049)})},
    {body: JSON.stringify({question: {}, turnstileToken: 't'})},
    {body: JSON.stringify({question: 'hi', turnstileToken: 't', unexpected: 'x'})},
    {headers: {'content-type': 'text/plain'}}]) assert.throws(() => parseRequest(event('chatbot', patch)));
  assert.equal(parseRequest(event('chatbot', {path: '/dev/chatbot'})).action, 'chatbot');
  assert.equal(parseRequest(event('chatbot', {body: JSON.stringify({question: 'x'.repeat(4000), turnstileToken: 't'})})).body.question.length, 4000);
});
test('responses cannot be cached or shared across origins', () => {
  const headers = responseHeaders(event(), config.origins);
  assert.equal(headers['Cache-Control'], 'no-store'); assert.equal(headers.Vary, 'Origin');
  assert.equal(headers['Access-Control-Allow-Origin'], 'https://doctorew.com');
  assert.equal(responseHeaders(event('chatbot', {headers: {origin: 'https://evil.invalid'}}), config.origins)['Access-Control-Allow-Origin'], undefined);
});
test('invalid quota configuration fails closed', () => {
  for (const value of ['0', '-1', 'nope', '1.5', 'Infinity']) assert.throws(() => configuration({AI_DAILY_LIMIT: value}), {statusCode: 503});
});
test('IaC plugin attaches API throttles without guessing generated resource IDs', () => {
  const Plugin = require('../scripts/stage-guard.cjs');
  const deployment = {Type: 'AWS::ApiGateway::Deployment', Properties: {}};
  const serverless = {service: {provider: {compiledCloudFormationTemplate: {Resources: {generated: deployment}}}}};
  new Plugin(serverless).hooks['after:aws:package:finalize:mergeCustomProviderResources']();
  assert.deepEqual(deployment.Properties.StageDescription.MethodSettings[0], {HttpMethod: '*', ResourcePath: '/*', DataTraceEnabled: false, ThrottlingRateLimit: 2, ThrottlingBurstLimit: 5});
});
test('Lambda handler denies all five routes without initializing the paid model', async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const {handler} = require('../dist/src/handler');
  for (const action of ACTIONS) {
    const result = await handler(event(action, {body: JSON.stringify({question: 'Hi', programmingLanguage: 'Python'})}));
    assert.equal(result.statusCode, 403);
    assert.deepEqual(JSON.parse(result.body), {error: 'Please complete the verification and try again.'});
  }
  if (previous !== undefined) process.env.OPENAI_API_KEY = previous;
});
test('Lambda handler rejects a supplied token when backend secret/table is missing', async () => {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  const table = process.env.AI_GUARD_TABLE;
  delete process.env.TURNSTILE_SECRET_KEY; delete process.env.AI_GUARD_TABLE;
  const {handler} = require('../dist/src/handler');
  const result = await handler(event());
  assert.equal(result.statusCode, 503);
  assert.deepEqual(JSON.parse(result.body), {error: 'AI demos are temporarily unavailable.'});
  if (secret !== undefined) process.env.TURNSTILE_SECRET_KEY = secret;
  if (table !== undefined) process.env.AI_GUARD_TABLE = table;
});
