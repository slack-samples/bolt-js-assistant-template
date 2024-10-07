const { App, LogLevel, Assistant } = require('@slack/bolt');
const { config } = require('dotenv');
const { OpenAI } = require('openai');

config();

/** Initialization */
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
  logLevel: LogLevel.DEBUG,
});

/** OpenAI Setup */
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const DEFAULT_SYSTEM_CONTENT = `You're an assistant in a Slack workspace.
Users in the workspace will ask you to help them write something or to think better about a specific topic.
You'll respond to those questions in a professional way.
When you include markdown text, convert them to Slack compatible ones.
When a prompt has Slack's special syntax like <@USER_ID> or <#CHANNEL_ID>, you must keep them as-is in your response.`;

const assistant = new Assistant({
  /**
  * `assistant_thread_context_changed` is sent when a user switches channels
  * while the Assistant container is open.
  * https://api.slack.com/events/assistant_thread_context_changed
  */
  threadContextChanged: async ({ client, event, context }) => {
    const { channel_id, thread_ts, context: assistantContext } = event.assistant_thread;

    // Retrieve first several messages from the current Assistant thread
    const thread = await client.conversations.replies({
      channel: channel_id,
      ts: thread_ts,
      oldest: thread_ts,
      include_all_metadata: true,
      limit: 4,
    });

    // Find and update the initial Assistant message with the new context to ensure the
    // thread always contains the most recent context that user is sending messages from.
    const initialMessage = thread.messages.find((m) => !m.subtype && m.user === context.botUserId);
    if (initialMessage) {
      const { ts, text, blocks } = initialMessage;
      await client.chat.update({
        channel: channel_id,
        ts,
        text,
        blocks,
        metadata: { event_type: 'assistant_thread_context', event_payload: assistantContext },
      });
    }
  },

  /**
  * `assistant_thread_started` is sent when a user opens the Assistant container.
  * This can happen via DM with the app or as a side-container within a channel.
  * https://api.slack.com/events/assistant_thread_started
  */
  threadStarted: async ({ client, event }) => {
    const { channel_id, thread_ts, context } = event.assistant_thread;

    // Since context is not sent along with individual user messages, it's necessary to keep
    // track of the context of the conversation to better assist the user. Sending an initial
    // message to the user with context metadata facilitates this, and allows us to update it
    // whenever the user changes context (via the `assistant_thread_context_changed` event).
    // !! Please note: this is only intended for development and demonstrative purposes.
    await client.chat.postMessage({
      channel: channel_id,
      thread_ts,
      text: 'Hi, how can I help?',
      metadata: { event_type: 'assistant_thread_context', event_payload: context },
    });

    const prompts = [{
      title: 'This is an example prompt',
      message: 'When the user clicks a prompt, the resulting sample prompt message text can be passed to your LLM for processing',
    }];

    // If the user opens the Assistant container in a channel, additional
    // context is available.This can be used to provide conditional prompts
    // that only make sense to appear in that context (like summarizing a channel).
    if (context.channel_id) {
      prompts.push({ title: 'This is a conditional prompt', message: "It's good to have options!" });
    }

    /**
     * Provide the user up to 4 optional, preset prompts to choose from.
     * https://api.slack.com/methods/assistant.threads.setSuggestedPrompts
     */
    await client.assistant.threads.setSuggestedPrompts({
      channel_id,
      thread_ts,
      prompts,
    });
  },

  /**
  * Messages sent to the Assistant do not contain a subtype and must
  * be deduced based on their shape and metadata (if provided).
  * https://api.slack.com/events/message
  */
  userMessage: async ({ client, message }) => {
    const { channel, channel_type, subtype, thread_ts } = message;

    // Do not process message if not a message intended for the Assistant.
    // For all other messages types, we recommend separate message handlers.
    const isAssistantMessage = channel_type === 'im' && (!subtype || subtype === 'file_share');
    if (!isAssistantMessage) return;

    /**
     * Set the title of the Assistant thread to capture the topic and facilitate future referencing.
     * https://api.slack.com/methods/assistant.threads.setTitle
     */
    await client.assistant.threads.setTitle({
      channel_id: channel,
      thread_ts,
      title: message.text,
    });

    /**
     * Set the status of the Assistant to give the appearance of active processing.
     * Clear the status upon returning the response by making the same call with an empty string.
     * https://api.slack.com/methods/assistant.threads.setStatus
     */
    await client.assistant.threads.setStatus({
      channel_id: channel,
      thread_ts,
      status: 'is typing..',
    });

    /** Scenario 1: Handle prompt selection */
    const isPrompt = message.text.includes('When the user clicks a prompt') || message.text.includes("It's good to have options!");
    if (isPrompt) {
      // Do something specific per the prompt
      client.chat.postMessage({
        channel,
        thread_ts,
        text: 'Prompts are useful for pre-determined and common actions where LLM processing might not be necessary. See the LLM in action by sending a message now!',
      });

      // Clear the Assistant processing status
      await client.assistant.threads.setStatus({
        channel_id: channel,
        thread_ts,
        status: '',
      });

      return;
    }

    /** Scenario 2: Format and pass all free-form user messages directly to the LLM */

    // Retrieve the thread history for any relevant context of the question being asked
    const thread = await client.conversations.replies({
      channel,
      ts: thread_ts,
      oldest: thread_ts,
    });

    // Prepare and tag the messages for LLM processing
    const userMessage = { role: 'user', content: message.text };
    const threadHistory = thread.messages.map((m) => {
      const role = m.bot_id ? 'assistant' : 'user';
      return { role, content: m.text };
    });

    const messages = [
      { role: 'system', content: DEFAULT_SYSTEM_CONTENT },
      ...threadHistory,
      userMessage,
    ];

    // Send message history and newest question to LLM
    const llmResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      n: 1,
      messages,
    });

    // Provide a response to the user
    await client.chat.postMessage({
      channel,
      thread_ts,
      text: llmResponse.choices[0].message.content,
    });

    // Clear the Assistant processing status
    await client.assistant.threads.setStatus({
      channel_id: channel,
      thread_ts,
      status: '',
    });
  },
});

app.assistant(assistant);

/** Start the Bolt App */
(async () => {
  try {
    await app.start();
    console.log('⚡️ Bolt app is running!');
  } catch (error) {
    console.error('Failed to start the app', error);
  }
})();
