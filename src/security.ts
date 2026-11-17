import { isBuddyPersonality } from './buddySafety';
import { parseChannelRequest } from "./channelPlanner";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { request } from "https";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, TransactWriteCommand, TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { APIGatewayProxyEvent } from "aws-lambda";

export const ACTIONS = ["chatbot", "translation", "personalAssistant", "sentimentAnalysis", "foxtrot"] as const;
export type Action = typeof ACTIONS[number];
export class PublicError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}
export interface GuardConfig {
  secret: string;
  table: string;
  hostnames: string[];
  origins: string[];
  dailyLimit: number;
  monthlyLimit: number;
  hourlyIpLimit: number;
}
export interface Body {
  mode?: string;
  host?: string;
  shows?: string;
  question?: string;
  language?: string;
  programmingLanguage?: string;
  personality?: string;
  turnstileToken?: string;
  sessionToken?: string;
}
export interface Verification { success?: boolean; hostname?: string; action?: string; }
export interface GuardDependencies {
  verify: (secret: string, token: string, ip: string) => Promise<Verification>;
  transact: (params: TransactWriteCommandInput) => Promise<unknown>;
  now: () => Date;
  pause?: (milliseconds: number) => Promise<void>;
}
const list = (s: string | undefined, defaults: string[]) => s ? s.split(",").map(x => x.trim()).filter(Boolean) : defaults;
function limit(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new PublicError(503, "AI demos are temporarily unavailable.");
  return n;
}
export function configuration(env = process.env): GuardConfig {
  return {
    secret: env.TURNSTILE_SECRET_KEY || "",
    table: env.AI_GUARD_TABLE || "",
    hostnames: list(env.TURNSTILE_HOSTNAMES, ["doctorew.com", "www.doctorew.com"]),
    origins: list(env.AI_ALLOWED_ORIGINS, ["https://doctorew.com", "https://www.doctorew.com"]),
    dailyLimit: limit(env.AI_DAILY_LIMIT, 300),
    monthlyLimit: limit(env.AI_MONTHLY_LIMIT, 2000),
    hourlyIpLimit: limit(env.AI_HOURLY_IP_LIMIT, 60),
  };
}
export function originOf(event: APIGatewayProxyEvent): string {
  return Object.entries(event.headers || {}).find(([key]) => key.toLowerCase() === "origin")?.[1] || "";
}
export function responseHeaders(event: APIGatewayProxyEvent, origins: string[]): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", "Vary": "Origin",
  };
  const origin = originOf(event);
  if (origins.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}
function parseBody(event: APIGatewayProxyEvent, caps: Record<string, number>, maxBytes = 16384): Body {
  if (event.httpMethod !== "POST") throw new PublicError(405, "Method not allowed.");
  if (event.isBase64Encoded || !event.body || Buffer.byteLength(event.body, "utf8") > maxBytes) {
    throw new PublicError(400, "Invalid request.");
  }
  const contentType = Object.entries(event.headers || {}).find(([key]) => key.toLowerCase() === "content-type")?.[1] || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) throw new PublicError(415, "Use a JSON request.");
  let body: Body;
  try { body = JSON.parse(event.body); } catch { throw new PublicError(400, "Invalid request."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new PublicError(400, "Invalid request.");
  for (const [key, value] of Object.entries(body)) {
    if (!Object.prototype.hasOwnProperty.call(caps, key) || typeof value !== "string" || value.length > caps[key]) throw new PublicError(400, "Invalid request.");
  }
  return body;
}
export function routeOf(event: APIGatewayProxyEvent): string {
  return (event.path || "").replace(/^\/dev\//, "/").slice(1);
}
export function parseRequest(event: APIGatewayProxyEvent): { action: Action; body: Body } {
  const action = routeOf(event);
  if (!(ACTIONS as readonly string[]).includes(action)) throw new PublicError(404, "Not found.");
  const body = parseBody(event, {question: 4000, language: 80, programmingLanguage: 80, personality: 80, turnstileToken: 2048, sessionToken: 2048, mode: 16, host: 16, shows: 20000}, 32768);
  if (body.mode !== "channel" && Buffer.byteLength(event.body || "", "utf8") > 16384) throw new PublicError(400, "Invalid request.");
  if (!Object.prototype.hasOwnProperty.call(body, "sessionToken") && !body.turnstileToken?.trim()) throw new PublicError(403, "Please complete the verification and try again.");
  if (body.mode !== undefined || body.host !== undefined || body.shows !== undefined) {
    if (body.mode === "buddy") {
      if (action !== "chatbot" || !isBuddyPersonality(body.personality) || body.host !== undefined || body.shows !== undefined || body.language !== undefined || body.programmingLanguage !== undefined) throw new PublicError(400, "Invalid buddy request.");
    } else {
      if (action !== "chatbot" || body.mode !== "channel" || body.personality !== undefined || body.language !== undefined || body.programmingLanguage !== undefined) throw new PublicError(400, "Invalid channel request.");
      try { parseChannelRequest(body); } catch { throw new PublicError(400, "Invalid channel request or available-show list."); }
    }
  }
  if (action === "foxtrot") {
    if (!body.programmingLanguage?.trim()) throw new PublicError(400, "Choose a programming language.");
  } else if (!body.question?.trim()) throw new PublicError(400, "Enter a question or text first.");
  return {action: action as Action, body};
}
export function verifyToken(secret: string, token: string, ip: string): Promise<Verification> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({secret, response: token, remoteip: ip});
    const req = request("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", headers: {"Content-Type": "application/json", "Content-Length": Buffer.byteLength(data)},
      timeout: 5000,
    }, res => {
      let text = "";
      res.on("data", chunk => { text += chunk; if (text.length > 16384) res.destroy(new Error("Oversized verification response")); });
      res.on("error", reject);
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error("Verification unavailable"));
        try { resolve(JSON.parse(text)); } catch { reject(new Error("Invalid verification response")); }
      });
    });
    const deadline = setTimeout(() => req.destroy(new Error("Verification timeout")), 5000);
    req.on("close", () => clearTimeout(deadline));
    req.on("timeout", () => req.destroy(new Error("Verification timeout")));
    req.on("error", reject);
    req.end(data);
  });
}
export function quotaTransaction(config: GuardConfig, token: string, ip: string, now: Date, receiptKind = "token"): TransactWriteCommandInput {
  const epoch = Math.floor(now.getTime() / 1000);
  const date = now.toISOString();
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const ipHash = createHmac("sha256", config.secret).update(ip).digest("hex");
  const counters = [
    {pk: `day:${date.slice(0, 10)}`, cap: config.dailyLimit, ttl: epoch + 172800},
    {pk: `month:${date.slice(0, 7)}`, cap: config.monthlyLimit, ttl: epoch + 5616000},
    {pk: `ip:${date.slice(0, 13)}:${ipHash}`, cap: config.hourlyIpLimit, ttl: epoch + 7200},
  ];
  return {TransactItems: [
    {Put: {TableName: config.table, Item: {pk: `${receiptKind}:${tokenHash}`, expiresAt: epoch + 600}, ConditionExpression: "attribute_not_exists(pk)"}},
    ...counters.map(counter => ({Update: {
      TableName: config.table, Key: {pk: counter.pk},
      UpdateExpression: "SET expiresAt = :ttl ADD #used :one",
      ConditionExpression: "attribute_not_exists(#used) OR #used < :cap",
      ExpressionAttributeNames: {"#used": "used"},
      ExpressionAttributeValues: {":ttl": counter.ttl, ":one": 1, ":cap": counter.cap},
    }})),
  ]};
}
const client = DynamoDBDocumentClient.from(new DynamoDBClient({maxAttempts: 1}));
const defaultDependencies: GuardDependencies = {
  verify: verifyToken, transact: params => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    return client.send(new TransactWriteCommand(params), {abortSignal: controller.signal}).finally(() => clearTimeout(timer));
  }, now: () => new Date(),
};
function requestContext(event: APIGatewayProxyEvent, config: GuardConfig): {origin: string; ip: string} {
  if (!config.secret || !config.table || !config.hostnames.length || !config.origins.length) throw new PublicError(503, "AI demos are temporarily unavailable.");
  const origin = originOf(event);
  if (!config.origins.includes(origin)) throw new PublicError(403, "This origin is not allowed.");
  const ip = event.requestContext?.identity?.sourceIp;
  if (!ip) throw new PublicError(403, "Request verification failed.");
  return {origin, ip};
}
async function verifyChallenge(config: GuardConfig, token: string, ip: string, action: string, deps: GuardDependencies): Promise<void> {
  let verification: Verification;
  try { verification = await deps.verify(config.secret, token, ip); }
  catch { throw new PublicError(503, "Verification is temporarily unavailable. Please try again."); }
  if (!verification || verification.success !== true || !config.hostnames.includes(verification.hostname || "") || verification.action !== action) {
    throw new PublicError(403, "Please complete the verification and try again.");
  }
}
function base64url(value: Buffer): string {
  return value.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function sessionIpHash(secret: string, ip: string): string {
  return createHmac("sha256", secret).update("doctorew.ai.page-session.ip.v1\0" + ip).digest("hex");
}
function sessionSignature(secret: string, payload: string): Buffer {
  const key = createHmac("sha256", secret).update("doctorew.ai.page-session.signing-key.v1").digest();
  return createHmac("sha256", key).update("doctorew.ai.page-session.v1\0" + payload).digest();
}
export function createSession(config: GuardConfig, origin: string, ip: string, now: Date): {sessionToken: string; expiresAt: number} {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expiresAt = issuedAt + 1800;
  const payload = base64url(Buffer.from(JSON.stringify({
    v: 1, iat: issuedAt, exp: expiresAt, origin,
    ipHash: sessionIpHash(config.secret, ip), nonce: randomBytes(16).toString("hex"),
  })));
  return {sessionToken: `${payload}.${base64url(sessionSignature(config.secret, payload))}`, expiresAt};
}
export function validateSession(token: string, config: GuardConfig, origin: string, ip: string, now: Date): void {
  const invalid = () => new PublicError(401, "Page verification expired or is invalid. Please verify again.");
  if (token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw invalid();
  const [payload, suppliedSignature] = token.split(".");
  const expected = sessionSignature(config.secret, payload);
  const supplied = Buffer.from(suppliedSignature.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (supplied.length !== expected.length || !timingSafeEqual(expected, supplied) || base64url(supplied) !== suppliedSignature) throw invalid();
  let claims: {v: number; iat: number; exp: number; origin: string; ipHash: string; nonce: string};
  try { claims = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")); }
  catch { throw invalid(); }
  const epoch = Math.floor(now.getTime() / 1000);
  if (!claims || claims.v !== 1 || !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) ||
      claims.iat > epoch || claims.exp <= epoch || claims.exp - claims.iat !== 1800 ||
      claims.origin !== origin || claims.ipHash !== sessionIpHash(config.secret, ip) ||
      typeof claims.nonce !== "string" || !/^[a-f0-9]{32}$/.test(claims.nonce)) throw invalid();
}
interface TransactionFailure {
  code?: string;
  name?: string;
  CancellationReasons?: {Code?: string}[];
}
function transactionReasons(error: unknown): string[] {
  if (!error || typeof error !== "object") return [];
  const failure = error as TransactionFailure;
  if ((failure.code || failure.name) !== "TransactionCanceledException") return [];
  return (failure.CancellationReasons || []).map(reason => reason.Code || "None");
}
function conditionFailed(error: unknown): boolean {
  return transactionReasons(error).includes("ConditionalCheckFailed");
}
export async function transactWithConflictRetry(params: TransactWriteCommandInput, deps: GuardDependencies): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await deps.transact(params); return; }
    catch (error) {
      const reasons = transactionReasons(error);
      const conflictOnly = reasons.includes("TransactionConflict") && reasons.every(code => code === "None" || code === "TransactionConflict");
      if (!conflictOnly || attempt === 2) throw error;
      const delay = 40 * (attempt + 1) + Math.floor(Math.random() * 21);
      await (deps.pause || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))))(delay);
    }
  }
}
export async function bootstrapSession(event: APIGatewayProxyEvent, config: GuardConfig, deps: GuardDependencies = defaultDependencies): Promise<{sessionToken: string; expiresAt: number}> {
  if (routeOf(event) !== "session") throw new PublicError(404, "Not found.");
  const body = parseBody(event, {turnstileToken: 2048});
  if (!body.turnstileToken?.trim()) throw new PublicError(403, "Please complete the verification and try again.");
  const {origin, ip} = requestContext(event, config);
  await verifyChallenge(config, body.turnstileToken, ip, "page", deps);
  const now = deps.now();
  const tokenHash = createHash("sha256").update(body.turnstileToken).digest("hex");
  try {
    await transactWithConflictRetry({TransactItems: [{Put: {
      TableName: config.table, Item: {pk: `token:${tokenHash}`, expiresAt: Math.floor(now.getTime() / 1000) + 600},
      ConditionExpression: "attribute_not_exists(pk)",
    }}]}, deps);
  } catch (error) {
    if (conditionFailed(error)) throw new PublicError(403, "This verification was already used. Please verify again.");
    throw new PublicError(503, "AI demos are temporarily unavailable.");
  }
  return createSession(config, origin, ip, now);
}
export async function authorize(event: APIGatewayProxyEvent, config: GuardConfig, deps: GuardDependencies = defaultDependencies): Promise<{action: Action; body: Body}> {
  const parsed = parseRequest(event);
  const {origin, ip} = requestContext(event, config);
  const now = deps.now();
  let receipt: string;
  let receiptKind = "token";
  if (Object.prototype.hasOwnProperty.call(parsed.body, "sessionToken")) {
    validateSession(parsed.body.sessionToken || "", config, origin, ip, now);
    receipt = randomBytes(32).toString("hex");
    receiptKind = "request";
  } else {
    await verifyChallenge(config, parsed.body.turnstileToken || "", ip, parsed.action, deps);
    receipt = parsed.body.turnstileToken || "";
  }
  try { await transactWithConflictRetry(quotaTransaction(config, receipt, ip, now, receiptKind), deps); }
  catch (error) {
    if (conditionFailed(error)) throw new PublicError(429, "This demo has reached its usage limit, or this verification was already used. Please try again later.");
    throw new PublicError(503, "AI demos are temporarily unavailable.");
  }
  return parsed;
}
