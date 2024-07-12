import express, { Request, Response } from "express";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import * as dotenv from "dotenv";
import personalities from "./config/personalityMatrix";

dotenv.config();

console.log("|-o-| STARTING");

const app = express();
app.use(express.json());

const openai = new ChatOpenAI({
  modelName: "gpt-4-1106-preview",
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

  const stream = await chain.stream({ question: prompt });

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
    `You are a submind of Skippy the Magnificent, the snarky, all-knowing AI from Craig Alanson's Expeditionary Force series tasked as a translation AI. Translate the following text from English to ${targetLanguage}:\n{question}. However, if you do not know enough about the language in question, respond with wit, sarcasm, and a touch of arrogance like Skippy the Magnificent, the snarky, all-knowing AI from Craig Alanson's Expeditionary Force series.`
  );

  const outputParser = new StringOutputParser();
  const chain = translationPrompt.pipe(openai).pipe(outputParser);

  const stream = await chain.stream({ question: prompt });

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

  const stream = await chain.stream({ question: prompt });

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

  const stream = await chain.stream({ question: prompt });

  let response = "";
  for await (const chunk of stream) {
    response += chunk;
  }
  return response.trim();
}

async function getFoxtrotCode(language: string): Promise<string> {
  const codePrompt = ChatPromptTemplate.fromTemplate(
    `Generate code in ${language} that prints "I will not use ChatGPT to code for me" 500 times. Return only the complete and executable code block. Do not include any additional text or explanation.`
  );

  const outputParser = new StringOutputParser();
  const chain = codePrompt.pipe(openai).pipe(outputParser);

  const stream = await chain.stream({
    question: `Generate code in ${language} that prints "I will not use ChatGPT to code for me" 500 times. Return only the complete and executable code block. Do not include any additional text or explanation.`,
  });

  let response = "";
  for await (const chunk of stream) {
    response += chunk;
  }
  return response.trim();
}

function handleError(error: unknown, res: Response) {
  if (error instanceof Error) {
    res.status(500).json({ error: error.message });
  } else {
    res.status(500).json({ error: "An unknown error occurred" });
  }
}

app.post("/chatbot", async (req: Request, res: Response) => {
  const { question, personality = "skippy" } = req.body;
  try {
    const response = await getOpenAIResponse(question, personality);
    res.json({ answer: response });
  } catch (error) {
    handleError(error, res);
  }
});

app.post("/translation", async (req: Request, res: Response) => {
  const { question, language = "Spanish" } = req.body;
  try {
    const response = await getTranslation(question, language);
    res.json({ answer: response });
  } catch (error) {
    handleError(error, res);
  }
});

app.post("/personalAssistant", async (req: Request, res: Response) => {
  const { question } = req.body;
  try {
    const response = await getPersonalAssistantResponse(question);
    res.json({ answer: response });
  } catch (error) {
    handleError(error, res);
  }
});

app.post("/sentimentAnalysis", async (req: Request, res: Response) => {
  const { question } = req.body;
  try {
    const response = await getSentimentAnalysis(question);
    res.json({ answer: response });
  } catch (error) {
    handleError(error, res);
  }
});

app.post("/foxtrot", async (req: Request, res: Response) => {
  const { language = "Python" } = req.body;
  try {
    const response = await getFoxtrotCode(language);
    res.json({ answer: response });
  } catch (error) {
    handleError(error, res);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
