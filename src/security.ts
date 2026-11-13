import { createHash, createHmac } from "crypto";
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
  question?: string;
  language?: string;
  programmingLanguage?: string;
  personality?: string;
  turnstileToken: string;
}
export interface Verification { success?: boolean; hostname?: string; action?: string; }
export interface GuardDependencies {
  verify: (secret: string, token: string, ip: string) => Promise<Verification>;
  transact: (params: TransactWriteCommandInput) => Promise<unknown>;
  now: () => Date;
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
export function parseRequest(event: APIGatewayProxyEvent): { action: Action; body: Body } {
  const action = (event.path || "").replace(/^\/dev\//, "/").slice(1);
  if (!(ACTIONS as readonly string[]).includes(action)) throw new PublicError(404, "Not found.");
  if (event.httpMethod !== "POST") throw new PublicError(405, "Method not allowed.");
  if (event.isBase64Encoded || !event.body || Buffer.byteLength(event.body, "utf8") > 16384) {
    throw new PublicError(400, "Invalid request.");
  }
  const contentType = Object.entries(event.headers || {}).find(([key]) => key.toLowerCase() === "content-type")?.[1] || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) throw new PublicError(415, "Use a JSON request.");
  let body: Body;
  try { body = JSON.parse(event.body); } catch { throw new PublicError(400, "Invalid request."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new PublicError(400, "Invalid request.");
  const caps: Record<string, number> = {question: 4000, language: 80, programmingLanguage: 80, personality: 80, turnstileToken: 2048};
  for (const [key, value] of Object.entries(body)) {
    if (!Object.prototype.hasOwnProperty.call(caps, key) || typeof value !== "string" || value.length > caps[key]) throw new PublicError(400, "Invalid request.");
  }
  if (typeof body.turnstileToken !== "string" || !body.turnstileToken.trim()) throw new PublicError(403, "Please complete the verification and try again.");
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
export function quotaTransaction(config: GuardConfig, token: string, ip: string, now: Date): TransactWriteCommandInput {
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
    {Put: {TableName: config.table, Item: {pk: `token:${tokenHash}`, expiresAt: epoch + 600}, ConditionExpression: "attribute_not_exists(pk)"}},
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
export async function authorize(event: APIGatewayProxyEvent, config: GuardConfig, deps: GuardDependencies = {
  verify: verifyToken, transact: params => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    return client.send(new TransactWriteCommand(params), {abortSignal: controller.signal}).finally(() => clearTimeout(timer));
  }, now: () => new Date(),
}): Promise<{action: Action; body: Body}> {
  const parsed = parseRequest(event);
  if (!config.secret || !config.table || !config.hostnames.length || !config.origins.length) throw new PublicError(503, "AI demos are temporarily unavailable.");
  if (!config.origins.includes(originOf(event))) throw new PublicError(403, "This origin is not allowed.");
  const ip = event.requestContext?.identity?.sourceIp;
  if (!ip) throw new PublicError(403, "Request verification failed.");
  let verification: Verification;
  try { verification = await deps.verify(config.secret, parsed.body.turnstileToken, ip); }
  catch { throw new PublicError(503, "Verification is temporarily unavailable. Please try again."); }
  if (!verification || verification.success !== true || !config.hostnames.includes(verification.hostname || "") || verification.action !== parsed.action) {
    throw new PublicError(403, "Please complete the verification and try again.");
  }
  try { await deps.transact(quotaTransaction(config, parsed.body.turnstileToken, ip, deps.now())); }
  catch (error) {
    if (((error as {code?: string; name?: string}).code || (error as Error).name) === "TransactionCanceledException") throw new PublicError(429, "This demo has reached its usage limit, or this verification was already used. Please try again later.");
    throw new PublicError(503, "AI demos are temporarily unavailable.");
  }
  return parsed;
}
