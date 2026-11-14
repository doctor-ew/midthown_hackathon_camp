import { ChatPromptTemplate } from "@langchain/core/prompts";
import personalities from "./personalityMatrix";

export function buildChatPrompt(personality: string): ChatPromptTemplate {
  const selected = Object.prototype.hasOwnProperty.call(personalities, personality) ? personality : "skippy";
  if (selected === "skippy") {
    return ChatPromptTemplate.fromMessages([
      ["system", personalities.skippy],
      ["human", "{question}"],
    ]);
  }
  return ChatPromptTemplate.fromTemplate(personalities[selected]);
}
