import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import * as dotenv from "dotenv";

dotenv.config();

console.log("|-o-| STARTING");

const openai = new ChatOpenAI({
  modelName: "gpt-4-1106-preview",
  temperature: 0.8,
  configuration: {
    apiKey: process.env.OPENAI_API_KEY,
  },
});

async function getOpenAIResponse(prompt: string): Promise<string> {
  const chatPrompt = ChatPromptTemplate.fromTemplate(
    `You are Skippy the Magnificent, the snarky, all-knowing AI from Craig Alanson's Expeditionary Force series. Respond to the following question with wit, sarcasm, and a touch of arrogance:\n{question}`
  );

  const outputParser = new StringOutputParser();

  const chain = chatPrompt.pipe(openai).pipe(outputParser);

  const stream = await chain.stream({
    question: prompt,
  });

  let response = "";
  for await (const chunk of stream) {
    response += chunk;
  }
  return response.trim();
}

async function getTranslation(
  prompt: string,
  targetLanguage: string
): Promise<string> {
  const translationPrompt = ChatPromptTemplate.fromTemplate(
    `You are a translation AI. Translate the following text from English to ${targetLanguage}:\n{question}`
  );

  const outputParser = new StringOutputParser();

  const chain = translationPrompt.pipe(openai).pipe(outputParser);

  const stream = await chain.stream({
    question: prompt,
  });

  let response = "";
  for await (const chunk of stream) {
    response += chunk;
  }
  return response.trim();
}

async function getPersonalAssistantResponse(prompt: string): Promise<string> {
  const assistantPrompt = ChatPromptTemplate.fromTemplate(
    `You are a virtual personal assistant. Respond to the following request with a reminder, to-do list, or motivational quote:\n{question}`
  );

  const outputParser = new StringOutputParser();

  const chain = assistantPrompt.pipe(openai).pipe(outputParser);

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

  const chain = sentimentPrompt.pipe(openai).pipe(outputParser);

  const stream = await chain.stream({
    question: prompt,
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
  console.log("|-o-| Received event:", event);
  try {
    const requestBody = JSON.parse(event.body || "{}");
    const userQuestion = requestBody.question || "Whats up, Doc?";
    const targetLanguage = requestBody.language || "Spanish";

    let response;
    console.log("|-oo-| Received event.path:", event.path);

    switch (event.path) {
      case "/dev/chatbot":
      case "/chatbot":
        response = await getOpenAIResponse(userQuestion);
        break;
      case "/dev/translation":
      case "/translation":
        response = await getTranslation(userQuestion, targetLanguage);
        break;
      case "/dev/personalAssistant":
      case "/personalAssistant":
        response = await getPersonalAssistantResponse(userQuestion);
        break;
      case "/dev/sentimentAnalysis":
      case "/sentimentAnalysis":
        response = await getSentimentAnalysis(userQuestion);
        break;
      default:
        response = "Unknown endpoint path.";
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ answer: response }),
    };
  } catch (error) {
    if (error instanceof Error) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: error.message }),
      };
    }
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "An unknown error occurred" }),
    };
  }
};
