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
  clientOptions: {
    slackApiUrl: process.env.SLACK_API_URL || 'https://slack.com/api',
  },
});

// OpenAI configuration
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
   * (Recommended) A custom ThreadContextStore can be provided, inclusive of methods to
   * get and save thread context. When provided, these methods will override the `getThreadContext`
   * and `saveThreadContext` utilities that are made available in other Assistant event listeners.
   */
  // threadContextStore: {
  //   get: async ({ context, client, payload }) => {},
  //   save: async ({ context, client, payload }) => {},
  // },

  /**
   * `assistant_thread_started` is sent when a user opens the Assistant container.
   * This can happen via DM with the app or as a side-container within a channel.
   *
   * @see {@link https://docs.slack.dev/reference/events/assistant_thread_started}
   */
  threadStarted: async ({ event, logger, say, setSuggestedPrompts, saveThreadContext }) => {
    const { context } = event.assistant_thread;

    try {
      /**
       * Since context is not sent along with individual user messages, it's necessary to keep
       * track of the context of the conversation to better assist the user. Sending an initial
       * message to the user with context metadata facilitates this, and allows us to update it
       * whenever the user changes context (via the `assistant_thread_context_changed` event).
       * The `say` utility sends this metadata along automatically behind the scenes.
       * !! Please note: this is only intended for development and demonstrative purposes.
       */
      await say('Hi, how can I help?');

      await saveThreadContext();

      /**
       * Provide the user up to 4 optional, preset prompts to choose from.
       *
       * The first `title` prop is an optional label above the prompts that
       * defaults to 'Try these prompts:' if not provided.
       *
       * @see {@link https://docs.slack.dev/reference/methods/assistant.threads.setSuggestedPrompts}
       */
      if (!context.channel_id) {
        await setSuggestedPrompts({
          title: 'Start with this suggested prompt:',
          prompts: [
            {
              title: 'This is a suggested prompt',
              message:
                'When a user clicks a prompt, the resulting prompt message text ' +
                'can be passed directly to your LLM for processing.\n\n' +
                'Assistant, please create some helpful prompts I can provide to ' +
                'my users.',
            },
          ],
        });
      }

      /**
       * If the user opens the Assistant container in a channel, additional
       * context is available. This can be used to provide conditional prompts
       * that only make sense to appear in that context.
       */
      if (context.channel_id) {
        await setSuggestedPrompts({
          title: 'Perform an action based on the channel',
          prompts: [
            {
              title: 'Summarize channel',
              message: 'Assistant, please summarize the activity in this channel!',
            },
          ],
        });
      }
    } catch (e) {
      logger.error(e);
    }
  },

  /**
   * `assistant_thread_context_changed` is sent when a user switches channels
   * while the Assistant container is open. If `threadContextChanged` is not
   * provided, context will be saved using the AssistantContextStore's `save`
   * method (either the DefaultAssistantContextStore or custom, if provided).
   *
   * @see {@link https://docs.slack.dev/reference/events/assistant_thread_context_changed}
   */
  threadContextChanged: async ({ logger, saveThreadContext }) => {
    // const { channel_id, thread_ts, context: assistantContext } = event.assistant_thread;
    try {
      await saveThreadContext();
    } catch (e) {
      logger.error(e);
    }
  },

  /**
   * Messages sent from the user to the Assistant are handled in this listener.
   *
   * @see {@link https://docs.slack.dev/reference/events/message}
   */
  userMessage: async ({ client, logger, message, getThreadContext, say, setTitle, setStatus }) => {
    /**
     * Messages sent to the Assistant can have a specific message subtype.
     *
     * Here we check that the message has "text" and was sent to a thread to
     * skip unexpected message subtypes.
     *
     * @see {@link https://docs.slack.dev/reference/events/message#subtypes}
     */
    if (!('text' in message) || !('thread_ts' in message) || !message.text || !message.thread_ts) {
      return;
    }
    const { channel, thread_ts } = message;

    try {
      /**
       * Set the title of the Assistant thread to capture the initial topic/question
       * as a way to facilitate future reference by the user.
       *
       * @see {@link https://docs.slack.dev/reference/methods/assistant.threads.setTitle}
       */
      await setTitle(message.text);

      /**
       * Set the status of the Assistant to give the appearance of active processing.
       *
       * @see {@link https://docs.slack.dev/reference/methods/assistant.threads.setStatus}
       */
      await setStatus({
        status: 'thinking...',
        loading_messages: [
          'Teaching the hamsters to type faster…',
          'Untangling the internet cables…',
          'Consulting the office goldfish…',
          'Polishing up the response just for you…',
          'Convincing the AI to stop overthinking…',
        ],
      });

      /** Scenario 1: Handle suggested prompt selection
       * The example below uses a prompt that relies on the context (channel) in which
       * the user has asked the question (in this case, to summarize that channel).
       */
      if (message.text === 'Assistant, please summarize the activity in this channel!') {
        const threadContext = await getThreadContext();
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
            logger.error(e);
          }
        }

        // Prepare and tag the prompt and messages for LLM processing
        let llmPrompt = `Please generate a brief summary of the following messages from Slack channel <#${threadContext.channel_id}>:`;
        for (const m of channelHistory.messages.reverse()) {
          if (m.user) llmPrompt += `\n<@${m.user}> says: ${m.text}`;
        }

        // Send channel history and prepared request to LLM
        const llmResponse = await openai.responses.create({
          model: 'gpt-4o-mini',
          input: `System: ${DEFAULT_SYSTEM_CONTENT}\n\nUser: ${llmPrompt}`,
          stream: true,
        });

        // Provide a response to the user
        const streamer = client.chatStream({
          channel: channel,
          thread_ts: thread_ts,
        });

        for await (const chunk of llmResponse) {
          if (chunk.type === 'response.output_text.delta') {
            await streamer.append({
              markdown_text: chunk.delta,
            });
          }
        }
        await streamer.stop();
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
      const threadHistory = thread.messages.map((m) => {
        const role = m.bot_id ? 'Assistant' : 'User';
        return `${role}: ${m.text || ''}`;
      });
      // parsed threadHistory to align with openai.responses api input format
      const parsedThreadHistory = threadHistory.join('\n');

      // Send message history and newest question to LLM
      const llmResponse = await openai.responses.create({
        model: 'gpt-4o-mini',
        input: `System: ${DEFAULT_SYSTEM_CONTENT}\n\n${parsedThreadHistory}\nUser: ${message.text}`,
        stream: true,
      });

      const streamer = client.chatStream({
        channel: channel,
        thread_ts: thread_ts,
      });

      for await (const chunk of llmResponse) {
        if (chunk.type === 'response.output_text.delta') {
          await streamer.append({
            markdown_text: chunk.delta,
          });
        }
      }
      await streamer.stop();
    } catch (e) {
      logger.error(e);

      // Send message to advise user and clear processing status if a failure occurs
      await say({ text: `Sorry, something went wrong! ${e}` });
    }
  },
});

app.assistant(assistant);

/**
 * `app_mention` event allows your app to receive message events that directly
 * mention your app. The app must be a member of the channel/conversation to
 * receive the event. Messages in a DM with your app will not dispatch this event,
 * event if the message mentions your app.
 *
 * @see {@link https://docs.slack.dev/reference/events/app_mention/}
 */
app.event('app_mention', async ({ event, client, logger, say }) => {
  try {
    const { channel, text, team, user } = event;
    const thread_ts = event.thread_ts || event.ts;

    // Set the app's loading state while waiting for the LLM response
    await client.assistant.threads.setStatus({
      channel_id: channel,
      thread_ts: thread_ts,
      status: 'thinking...',
      loading_messages: [
        'Teaching the hamsters to type faster…',
        'Untangling the internet cables…',
        'Consulting the office goldfish…',
        'Polishing up the response just for you…',
        'Convincing the AI to stop overthinking…',
      ],
    });

    // Send message history and newest question to LLM
    const llmResponse = await openai.responses.create({
      model: 'gpt-4o-mini',
      input: `System: ${DEFAULT_SYSTEM_CONTENT}\n\nUser: ${text}`,
      stream: true,
    });

    // Stream the LLM response to the channel
    const streamer = client.chatStream({
      channel: channel,
      thread_ts: thread_ts,
      recipient_team_id: team,
      recipient_user_id: user,
    });

    for await (const chunk of llmResponse) {
      if (chunk.type === 'response.output_text.delta') {
        await streamer.append({
          markdown_text: chunk.delta,
        });
      }
    }

    await streamer.stop();
  } catch (e) {
    logger.error(e);

    // Send message to advise user and clear processing status if a failure occurs
    await say({ text: `Sorry, something went wrong! ${e}` });
  }
});

/** Start the Bolt App */
(async () => {
  try {
    await app.start();
    app.logger.info('⚡️ Bolt app is running!');
  } catch (error) {
    app.logger.error('Failed to start the app', error);
  }
})();
