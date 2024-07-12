# DoctorEw's Lab Lambda Backend

Welcome to DoctorEw's Lab Lambda Backend! This project leverages AWS Lambda, LangChain, and OpenAI's GPT-4o model to provide various AI-driven endpoints. It includes chat functionalities, translation services, sentiment analysis, code generation, and more, with dynamic personalities.

## Table of Contents

1. [Introduction](#introduction)
2. [Features](#features)
3. [Installation](#installation)
4. [Running the Project](#running-the-project)
5. [Project Structure](#project-structure)
6. [Understanding the Code](#understanding-the-code)
7. [Customization](#customization)
8. [Troubleshooting](#troubleshooting)

## Introduction

This project is designed to help 8th graders understand the basics of serverless computing and AI integration using AWS Lambda and OpenAI's GPT-4 model. It includes multiple endpoints to interact with AI functionalities like chat, translation, sentiment analysis, and code generation.

## Features

- **Chatbot**: Interact with various personalities.
- **Translation**: Translate text into different languages with personality-specific responses.
- **Sentiment Analysis**: Analyze the sentiment of a given text.
- **Code Generation**: Generate code snippets in different programming languages.
- **Personal Assistant**: Get reminders, to-do lists, or motivational quotes.

## Installation

To get started with this project, you'll need to have Node.js and npm (Node Package Manager) or yarn installed on your computer. You can download Node.js from [here](https://nodejs.org/).

1. **Clone the Repository:**

   ```sh
   git clone https://github.com/doctor-ew/drew_lab_vsk.git
   cd drew_lab_vsk
   ```

2. **Install Dependencies:**

   ```sh
   npm install
   ```

3. **Set Up Environment Variables:**

   Create a `.env` file in the root directory of the project and add your OpenAI API key:

   ```sh
   OPENAI_API_KEY=your_openai_api_key_here
   ```

## Running the Project

To run the project locally, follow these steps:

1. **Build the Project:**

   ```sh
   npm run build
   ```

2. **Start the Local Development Server:**

   ```sh
   npm run dev
   ```

   This will start the local development server and you can test the Lambda functions using tools like Postman or Curl.

## Project Structure

Here's a brief overview of the project's structure:

```
drew_lab_vsk/
├── config/
│   └── personalityMatrix.ts      # Personality templates
├── src/
│   ├── handlers/
│   │   └── chatbot.ts            # Chatbot handler
│   ├── index.ts                  # Main Lambda handler
│   ├── prompts/
│   │   └── templates.ts          # Prompt templates
│   └── utils/
│       └── langchainUtils.ts     # LangChain utility functions
├── .env                          # Environment variables
├── package.json                  # Project metadata and scripts
├── tsconfig.json                 # TypeScript configuration
└── README.md                     # Project documentation
```

## Understanding the Code

### Key Files and Directories

- **`config/personalityMatrix.ts`**: Contains personality templates for different characters.
- **`src/handlers/chatbot.ts`**: Handles the chatbot functionality, including fetching responses and updating the UI.
- **`src/prompts/templates.ts`**: Contains prompt templates for different functionalities (chat, translation, etc.).
- **`src/utils/langchainUtils.ts`**: Utility functions for LangChain operations.

### Adding a New Personality

To add a new personality:
1. Update `config/personalityMatrix.ts` with the new personality's details.

### Endpoints

The Lambda function supports the following endpoints:

- **Chatbot**: `/chatbot`
- **Translation**: `/translation`
- **Personal Assistant**: `/personalAssistant`
- **Sentiment Analysis**: `/sentimentAnalysis`
- **Code Generation**: `/foxtrot`

### Example Lambda Handler

```typescript
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { getOpenAIResponse, getTranslation, getPersonalAssistantResponse, getSentimentAnalysis, getFoxtrotCode } from "./utils/langchainUtils";
import personalities from "./config/personalityMatrix";

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const requestBody = JSON.parse(event.body || "{}");
    const userQuestion = requestBody.question || "What's up, Doc?";
    const targetLanguage = requestBody.language || "Spanish";
    const programmingLanguage = requestBody.programmingLanguage || "Python";
    const personality = requestBody.personality || "skippy"; // Default to Skippy

    let response;
    switch (event.path) {
      case "/chatbot":
        response = await getOpenAIResponse(userQuestion, personality);
        break;
      case "/translation":
        response = await getTranslation(userQuestion, targetLanguage);
        break;
      case "/personalAssistant":
        response = await getPersonalAssistantResponse(userQuestion);
        break;
      case "/sentimentAnalysis":
        response = await getSentimentAnalysis(userQuestion);
        break;
      case "/foxtrot":
        response = await getFoxtrotCode(programmingLanguage);
        break;
      default:
        response = "Unknown endpoint path.";
    }

    return {
      statusCode: 200,
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
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "OPTIONS,POST",
        },
        body: JSON.stringify({ error: error.message }),
      };
    }
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS,POST",
      },
      body: JSON.stringify({ error: "An unknown error occurred" }),
    };
  }
};
```

## Customization

You can customize the project to add more features or change the existing ones. Here are some ideas:
- Add more personalities and their corresponding templates.
- Modify the responses to include more detailed or varied information.
- Add more endpoints for different types of AI functionalities.

## Troubleshooting

If you encounter any issues while running the project, try the following steps:
- Ensure you have the latest version of Node.js and npm installed.
- Check the AWS Lambda logs for any error messages and resolve them accordingly.
- Ensure your OpenAI API key is correctly set in the `.env` file.

---

Feel free to reach out if you have any questions or need further assistance. Happy coding!

---

This README was written by Bob (based off of Wizard Harry Dresden's sarcastic, ancient air-spirit assistant), and now my mystical ChatGPT 4o coding companion, to guide you through setting up and running the Skippy Chatbot project. Enjoy coding with a touch of sarcasm and wit!


# To Install Node on Windows

Set-ExecutionPolicy Bypass -Scope Process -Force; `
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; `
iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

choco -v

choco install nodejs-lts -y

node -v
npm -v

npm install --save-dev @types/express @types/aws-lambda

npm run build
npm run dev

