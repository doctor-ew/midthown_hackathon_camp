import { buddyPrompt, safeBuddyReply } from './buddySafety';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { channelPrompt, parseChannelPlan, parseChannelRequest } from "./channelPlanner";
import * as dotenv from "dotenv";
import { buildChatPrompt, buildTranslationPrompt, buildCodePrompt, normalizeCharacterReply } from "./config/chatPrompt";
import { authorize, bootstrapSession, configuration, PublicError, responseHeaders, routeOf } from "./security";

dotenv.config();

let openai: ChatOpenAI | undefined;
function model(): ChatOpenAI {
  if (openai) return openai;
  openai = new ChatOpenAI({
    modelName: process.env.OPENAI_MODEL || "gpt-4o",
    temperature: 0.8,
    maxTokens: 600,
    timeout: 25000,
    maxRetries: 0,
    configuration: { apiKey: process.env.OPENAI_API_KEY },
  });
  return openai;
}

async function getOpenAIResponse(
  prompt: string,
  personality: string
): Promise<string> {
  const chatPrompt = buildChatPrompt(personality);
  const outputParser = new StringOutputParser();

  const chain = chatPrompt.pipe(model()).pipe(outputParser);

  const stream = await chain.stream({
    question: prompt,
  });

  let response = "";
  for await (const chunk of stream) {
    response += chunk;
  }

  return normalizeCharacterReply(response);
}

async function getTranslation(
  prompt: string,
  targetLanguage: string
): Promise<string> {
  const translationPrompt = buildTranslationPrompt();

  const outputParser = new StringOutputParser();

  const chain = translationPrompt.pipe(model()).pipe(outputParser);

  const stream = await chain.stream({
    question: prompt,
    language: targetLanguage,
  });

  let response = "";
  for await (const chunk of stream) {
    response += chunk;
  }
  return normalizeCharacterReply(response);
}

async function getPersonalAssistantResponse(prompt: string): Promise<string> {
  const assistantPrompt = ChatPromptTemplate.fromTemplate(
    `You are a virtual personal assistant. Respond to the following request with a reminder, to-do list, or motivational quote:\n{question}`
  );

  const outputParser = new StringOutputParser();

  const chain = assistantPrompt.pipe(model()).pipe(outputParser);

  const stream = await chain.stream({
    question: prompt,
  });

  let response = "";
  for await (const chunk of stream) {
    response += chunk;
  }
  return response.trim();
}

async function getSentimentAnalysis(prompt: string): Promise<string> {
  const sentimentPrompt = ChatPromptTemplate.fromTemplate(
    `You are an AI that analyzes the sentiment of a given text. Respond with "Positive", "Negative", or "Neutral" based on the sentiment of the following text:\n{question}`
  );

  const outputParser = new StringOutputParser();

  const chain = sentimentPrompt.pipe(model()).pipe(outputParser);

  const stream = await chain.stream({
    question: prompt,
  });

  let response = "";
  for await (const chunk of stream) {
    response += chunk;
  }
  return response.trim();
}

async function getFoxtrotCode(language: string): Promise<string> {
  const codePrompt = buildCodePrompt();

  const outputParser = new StringOutputParser();

  const chain = codePrompt.pipe(model()).pipe(outputParser);

  const stream = await chain.stream({
    programmingLanguage: language,
  });

  let response = "";
  for await (const chunk of stream) {
    response += chunk;
  }
  return response.trim();
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  let headers: Record<string, string> = {"Content-Type": "application/json", "Cache-Control": "no-store"};
  try {
    const config = configuration();
    headers = responseHeaders(event, config.origins);
    if (routeOf(event) === "session") {
      const grant = await bootstrapSession(event, config);
      return {statusCode: 200, headers, body: JSON.stringify(grant)};
    }
    const { action, body: requestBody } = await authorize(event, config);
    if (requestBody.mode === "channel") {
      const request = parseChannelRequest(requestBody);
      const text = await channelPrompt(request).pipe(model().bind({response_format: {type: "json_object"}})).pipe(new StringOutputParser()).invoke({request: request.question, catalog: JSON.stringify(request.shows)});
      let plan;
      try { plan = parseChannelPlan(text, request); }
      catch { throw new PublicError(503, "The host sent an invalid lineup. Please try again."); }
      return {statusCode: 200, headers, body: JSON.stringify({plan})};
    }
    if (requestBody.mode === "buddy") {
      const answer = await safeBuddyReply(requestBody.question || "", () => buddyPrompt(requestBody.personality || "").pipe(model()).pipe(new StringOutputParser()).invoke({question:requestBody.question}));
      return {statusCode:200,headers,body:JSON.stringify({answer})};
    }
    const userQuestion = requestBody.question || "";
    const targetLanguage = requestBody.language || "Spanish";
    const programmingLanguage = requestBody.programmingLanguage || "Python";
    const personality = requestBody.personality || "skippy";
    let response: string;
    switch (action) {
      case "chatbot": response = await getOpenAIResponse(userQuestion, personality); break;
      case "translation": response = await getTranslation(userQuestion, targetLanguage); break;
      case "personalAssistant": response = await getPersonalAssistantResponse(userQuestion); break;
      case "sentimentAnalysis": response = await getSentimentAnalysis(userQuestion); break;
      case "foxtrot": response = await getFoxtrotCode(programmingLanguage); break;
    }
    return {statusCode: 200, headers, body: JSON.stringify({answer: response.slice(0, 12000)})};
  } catch (error) {
    const statusCode = error instanceof PublicError ? error.statusCode : 503;
    const message = error instanceof PublicError ? error.message : "The AI demo is temporarily unavailable. Please try again.";
    if (statusCode === 429) headers["Retry-After"] = "3600";
    return {statusCode, headers, body: JSON.stringify({error: message, ...(statusCode === 401 ? {code: "verification_required"} : {})})};
  }
};
