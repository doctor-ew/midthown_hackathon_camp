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

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const requestBody = JSON.parse(event.body || "{}");
    const userQuestion = requestBody.question || "Whats up, Doc?";

    const skippyResponse = await getOpenAIResponse(userQuestion);

    return {
      statusCode: 200,
      body: JSON.stringify({ answer: skippyResponse }),
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
