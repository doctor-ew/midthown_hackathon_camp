import express from "express";
import { APIGatewayProxyEvent } from "aws-lambda";
import { handler } from "./handler";

// Local development uses exactly the same verification and quotas as Lambda.
const app = express();
app.disable("x-powered-by");
app.use(express.text({type: "application/json", limit: "16kb"}));
app.post("*", async (req, res) => {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers[key] = value;
  }
  const event = {
    httpMethod: req.method,
    path: req.path,
    headers,
    body: typeof req.body === "string" ? req.body : "",
    isBase64Encoded: false,
    requestContext: {identity: {sourceIp: req.socket.remoteAddress || ""}},
  } as APIGatewayProxyEvent;
  const result = await handler(event);
  for (const [key, value] of Object.entries(result.headers || {})) res.setHeader(key, String(value));
  res.status(result.statusCode).send(result.body);
});
app.use((_req, res) => { res.status(404).json({error: "Not found."}); });
app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(400).json({error: "Invalid request."});
});
const port = Number(process.env.PORT || 3000);
app.listen(port, "127.0.0.1", () => console.log(`Local AI demo listening on port ${port}`));
