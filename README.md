# Skippy Chatbot

Welcome to the Skippy Chatbot project! This project creates a chatbot using OpenAI GPT-4 and LangChain in TypeScript. The chatbot is inspired by Skippy the Magnificent from Craig Alanson's Expeditionary Force series, providing responses with wit, sarcasm, and a touch of arrogance.

## Introduction to Skippy the Magnificent

Skippy the Magnificent is an advanced AI from the Expeditionary Force series by Craig Alanson. Known for his snarky comments, vast knowledge, and a touch of arrogance, Skippy adds a unique flair to any conversation. This project aims to capture that essence and bring it to life in the form of a chatbot.

## Installation Guide

### Prerequisites

- [Node Version Manager (nvm)](https://github.com/nvm-sh/nvm) for managing Node.js versions.

### Steps

1. **Install nvm**:
   Follow the instructions on the [nvm repository](https://github.com/nvm-sh/nvm) to install nvm.

2. **Install Node.js LTS (Iron)**:
   Once nvm is installed, run the following commands to install and use the LTS version `Iron` (Node.js v20.11.0):

   ```sh
   nvm install lts/iron
   nvm use lts/iron
   nvm alias default lts/iron
   ```

3. **Clone the Repository**:
   Clone the repository to your local machine:


   ```sh
   git clone https://github.com/yourusername/skippy-chatbot.git
   cd skippy-chatbot
   ```

4. **Install Dependencies**:
   Install the project dependencies using pnpm:

   ```sh
   pnpm install
   ```

5. **Set Up Environment Variables**:
   Copy the env.example file to .env and fill in your OpenAI API key:

   ```sh
   Copy code
   cp env.example .env
   ```

Edit the .env file to add your OpenAI API key.

6. **Run the Project**:
   You can run the local test script to ensure everything is set up correctly:

   ```sh
   pnpm start
   ```

# TODO / Up Next
1. Add a input messages (e.g., from a chat box).
2. Test on AWS.

This README was written by Bob (based off of Wizard Harry Dresden's sarcastic, ancient air-spirit assistant), and now my mystical ChatGPT 4o coding companion, to guide you through setting up and running the Skippy Chatbot project. Enjoy coding with a touch of sarcasm and wit!

Feel free to contribute to the project or report any issues you encounter. Happy coding!
