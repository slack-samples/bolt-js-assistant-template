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
  * `assistant_thread_started` is sent when a user opens the Assistant container.
  * This can happen via DM with the app or as a side-container within a channel.
  * https://api.slack.com/events/assistant_thread_started
  */
  threadStarted: async ({ client, event }) => {
    const { channel_id, thread_ts, context } = event.assistant_thread;

    try {
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
        title: 'This is a suggested prompt',
        // eslint-disable-next-line
        message: `When a user clicks a prompt, the resulting prompt message text can be passed directly to your LLM for processing.\n\nAssistant, please create some helpful prompts I can provide to my users.`,
      }];

      // If the user opens the Assistant container in a channel, additional
      // context is available.This can be used to provide conditional prompts
      // that only make sense to appear in that context (like summarizing a channel).
      if (context.channel_id) {
        prompts.push({
          title: 'Summarize channel',
          message: 'Assistant, please summarize the activity in this channel!',
        });
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
    } catch (e) {
      console.error(e);
    }
  },

  /**
  * `assistant_thread_context_changed` is sent when a user switches channels
  * while the Assistant container is open.
  * https://api.slack.com/events/assistant_thread_context_changed
  */
  threadContextChanged: async ({ client, event, context }) => {
    const { channel_id, thread_ts, context: assistantContext } = event.assistant_thread;

    try {
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
      const initialMsg = thread.messages.find((m) => !m.subtype && m.user === context.botUserId);
      if (initialMsg) {
        const { ts, text, blocks } = initialMsg;
        await client.chat.update({
          channel: channel_id,
          ts,
          text,
          blocks,
          metadata: { event_type: 'assistant_thread_context', event_payload: assistantContext },
        });
      }
    } catch (e) {
      console.error(e);
    }
  },

  /**
  * Messages sent to the Assistant do not contain a subtype and must
  * be deduced based on their shape and metadata (if provided).
  * https://api.slack.com/events/message
  */
  userMessage: async ({ client, context, message }) => {
    const { channel, channel_type, subtype, thread_ts } = message;

    // Do not process message if not a message intended for the Assistant.
    // For all other messages types, we recommend separate message handlers.
    const isAssistantMessage = channel_type === 'im' && (!subtype || subtype === 'file_share');
    if (!isAssistantMessage) return;

    try {
      /**
       * Set the title of the Assistant thread to capture the initial topic/question
       * as a way to facilitate future reference by the user.
       * https://api.slack.com/methods/assistant.threads.setTitle
       */
      await client.assistant.threads.setTitle({
        channel_id: channel,
        thread_ts,
        title: message.text,
      });

      /**
       * Set the status of the Assistant to give the appearance of active processing.
       * https://api.slack.com/methods/assistant.threads.setStatus
       */
      await client.assistant.threads.setStatus({
        channel_id: channel,
        thread_ts,
        status: 'is typing..',
      });

      /** Scenario 1: Handle suggested prompt selection
       * The example below uses a prompt that relies on the context (channel) in which
       * the user has asked the question (in this case, to summarize that channel).
      */
      if (message.text === 'Assistant, please summarize the activity in this channel!') {
        // Retrieve the current thread history
        const thread = await client.conversations.replies({
          channel,
          ts: thread_ts,
          oldest: thread_ts,
          include_all_metadata: true,
          limit: 4,
        });

        // Find the first message in the thread that holds the current context using metadata.
        // See threadContextChanged above for a description and explanation for this approach.
        const initialMsg = thread.messages.find((m) => !m.subtype && m.user === context.botUserId);
        const threadContext = initialMsg && initialMsg.metadata
          ? initialMsg.metadata.event_payload : null;
        let channelHistory;

        try {
          channelHistory = await client.conversations.history({
            channel: threadContext.channel_id,
            limit: 50,
          });
        } catch (e) {
          // If the Assistant is not in the channel it's being asked about,
          // have it join the channel and then retry the API call
          if (e.data.error === 'not_in_channel') {
            await client.conversations.join({ channel: threadContext.channel_id });
            channelHistory = await client.conversations.history({
              channel: threadContext.channel_id,
              limit: 50,
            });
          } else {
            console.error(e);
          }
        }

        // Prepare and tag the prompt and messages for LLM processing
        let llmPrompt = `Please generate a brief summary of the following messages from Slack channel <#${threadContext.channel_id}:`;
        channelHistory.messages.reverse().forEach((m) => {
          if (m.user) llmPrompt += `\n<@${m.user}> says: ${m.text}`;
        });

        const messages = [
          { role: 'system', content: DEFAULT_SYSTEM_CONTENT },
          { role: 'user', content: llmPrompt },
        ];

        // Send channel history and prepared request to LLM
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

        return;
      }

      /**
       * Scenario 2: Format and pass user messages directly to the LLM
      */

      // Retrieve the Assistant thread history for context of question being asked
      const thread = await client.conversations.replies({
        channel,
        ts: thread_ts,
        oldest: thread_ts,
      });

      // Prepare and tag each message for LLM processing
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
    } catch (e) {
      console.error(e);

      await client.assistant.threads.setStatus({
        channel_id: channel,
        thread_ts,
        status: '',
      });
    }
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
