# AI Agent App Template (Bolt for JavaScript)

This Bolt for JavaScript template demonstrates how to build [AI Apps](https://docs.slack.dev/ai/) in Slack.

Models from [OpenAI](https://openai.com) are used and can be customized for prompts of all kinds.

## Setup

Before getting started, make sure you have a development workspace where you have permissions to install apps. If you don’t have one setup, go ahead and [create one](https://slack.com/create).

### Developer Program

Join the [Slack Developer Program](https://api.slack.com/developer-program) for exclusive access to sandbox environments for building and testing your apps, tooling, and resources created to help you build and grow.

## Installation

### Create a Slack App

1. Open [https://api.slack.com/apps/new](https://api.slack.com/apps/new) and
   choose "From an app manifest"
2. Choose the workspace you want to install the application to
3. Copy the contents of [manifest.json](./manifest.json) into the text box that
   says `*Paste your manifest code here*` (within the JSON tab) and click _Next_
4. Review the configuration and click _Create_
5. You'll then be redirected to App Settings. Visit the **Install App** page and install your app.

### Environment Variables

Before you can run the app, you'll need to store some environment variables.


1. Rename `.env.sample` to `.env`.
2. Open your apps setting page from [this list](https://api.slack.com/apps), click _OAuth & Permissions_ in the left hand menu, then copy the _Bot User OAuth Token_ into your `.env` file under `SLACK_BOT_TOKEN`.
```zsh
SLACK_BOT_TOKEN=YOUR_SLACK_BOT_TOKEN
```
3. Click _Basic Information_ from the left hand menu and follow the steps in the _App-Level Tokens_ section to create an app-level token with the `connections:write` scope. Copy that token into your `.env` as `SLACK_APP_TOKEN`.
```zsh
SLACK_APP_TOKEN=YOUR_SLACK_APP_TOKEN
```
4. Save your OpenAI key into `.env` under `OPENAI_API_KEY`.
```zsh
OPENAI_API_KEY=YOUR_OPEN_API_KEY
```


### Local Project

```zsh
# Clone this project onto your machine
git clone https://github.com/slack-samples/bolt-js-assistant-template.git

# Change into this project directory
cd bolt-js-assistant-template

# Install dependencies
npm install

# Run Bolt server
npm start
```

### Linting

```zsh
# Run lint for code formatting and linting
npm run lint
```

## Project Structure

### `manifest.json`

`manifest.json` is a configuration for Slack apps. With a manifest, you can create an app with a pre-defined configuration, or adjust the configuration of an existing app.

### `app.js`

`app.js` is the entry point for the application and is the file you'll run to start the server. This project aims to keep this file as thin as possible, primarily using it as a way to route inbound requests.
