import { handler } from "./src/handler";
//import { config } from "dotenv";

import * as dotenv from "dotenv";

dotenv.config();

async function testLocal() {
  const event = {
    body: JSON.stringify({ question: "What is the meaning of life?" }),
  };

  try {
    const result = await handler(event as any); // Only pass the event
    console.log("Response:", result);
  } catch (error) {
    console.error("Error:", error);
  }
}

testLocal();
