import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import * as dotenv from "dotenv";
import personalities from "./config/personalityMatrix";

dotenv.config();

console.log("|-o-| STARTING");

const openai = new ChatOpenAI({
  modelName: "gpt-4o-mini", //"gpt-4-1106-preview",
  temperature: 0.8,
  configuration: {
    apiKey: process.env.OPENAI_API_KEY,
  },
});

async function getOpenAIResponse(
  prompt: string,
  personality: string
): Promise<string> {
  const personalityTemplate =
    personalities[personality] || personalities["skippy"];

  const chatPrompt = ChatPromptTemplate.fromTemplate(personalityTemplate);
  const outputParser = new StringOutputParser();

  const chain = chatPrompt.pipe(openai).pipe(outputParser);

  const stream = await chain.stream({
    question: prompt,
  });

  let response = "";
  for await (const chunk of stream) {
    response += chunk;
  }

  let returnResponse = response.trim();

  console.log(
    `|-o-| Chat with: ${personality}! 
    :: prompt: ${prompt}
    || getOpenAIResponse: returnResponse: ${returnResponse}`
  );

  return response.trim();
}

async function getTranslation(
  prompt: string,
  targetLanguage: string
): Promise<string> {
  const translationPrompt = ChatPromptTemplate.fromTemplate(
    `You are a submind of Skippy the Magnificent, the snarky, all-knowing AI from Craig Alanson's Expeditionary Force series tasked as a translation AI. Translate the following text from English to ${targetLanguage}:\n{question}. However, if you do not know enough about the language in question, respond with wit, sarcasm, and a touch of arrogance like Skippy the Magnificent, the snarky, all-knowing AI from Craig Alanson's Expeditionary Force series.`
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

async function getFoxtrotCode(language: string): Promise<string> {
  /*
  const codePrompt = ChatPromptTemplate.fromTemplate(
    `Generate code in ${language} that prints "I will not use ChatGPT to code for me" 500 times.`
  );
  */
  const codePrompt = ChatPromptTemplate.fromTemplate(
    `Generate code in ${language} that prints "I will not use ChatGPT to code for me" 500 times. Return only the complete and executable code block. Do not include any additional text or explanation.`
  );

  const outputParser = new StringOutputParser();

  const chain = codePrompt.pipe(openai).pipe(outputParser);

  const stream = await chain.stream({
    //question: `Generate code in ${language} that prints "I will not use ChatGPT to code for me" 500 times.`,
    question: `Generate code in ${language} that prints "I will not use ChatGPT to code for me" 500 times. Return only the complete and executable code block. Do not include any additional text or explanation.`,
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
  // console.log("|-o-| Received event:", event);
  try {
    const requestBody = JSON.parse(event.body || "{}");
    const userQuestion = requestBody.question || "Whats up, Doc?";
    const targetLanguage = requestBody.language || "Spanish";
    const programmingLanguage = requestBody.programmingLanguage || "Python";
    const personality = requestBody.personality || "skippy"; // Default to Skippy

    let response;
    // console.log("|-oo-| Received event.path:", event.path);

    switch (event.path) {
      case "/dev/chatbot":
      case "/chatbot":
        response = await getOpenAIResponse(userQuestion, personality);
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
      case "/dev/foxtrot":
      case "/foxtrot":
        response = await getFoxtrotCode(programmingLanguage);
        break;
      default:
        response = "Unknown endpoint path.";
    }

    return {
      statusCode: 200,
      /*
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      */
      headers: {
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS,POST",
      },
      body: JSON.stringify({ answer: response }),
    };
  } catch (error) {
    if (error instanceof Error) {
      return {
        statusCode: 500,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Methods": "OPTIONS,POST",
        },
        body: JSON.stringify({ error: error.message }),
      };
    }
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "OPTIONS,POST",
      },
      body: JSON.stringify({ error: "An unknown error occurred" }),
    };
  }
};
