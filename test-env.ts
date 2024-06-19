// test-env.ts
import { config } from "dotenv";

config();

console.log("Testing .env file: OpenAI API Key:", process.env.OPENAI_API_KEY);
