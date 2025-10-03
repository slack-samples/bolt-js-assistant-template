import { DEFAULT_SYSTEM_CONTENT, openai } from '../../ai/index.js';
import { feedbackBlock } from '../views/feedback_block.js';

/**
 * `assistant_thread_started` is sent when a user opens the Assistant container.
 * This can happen via DM with the app or as a side-container within a channel.
 *
 * @see {@link https://docs.slack.dev/reference/events/assistant_thread_started}
 */
export const threadStarted = async ({ event, logger, say, setSuggestedPrompts, saveThreadContext }) => {
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
};

/**
 * `assistant_thread_context_changed` is sent when a user switches channels
 * while the Assistant container is open. If `threadContextChanged` is not
 * provided, context will be saved using the AssistantContextStore's `save`
 * method (either the DefaultAssistantContextStore or custom, if provided).
 *
 * @see {@link https://docs.slack.dev/reference/events/assistant_thread_context_changed}
 */
export const threadContextChanged = async ({ logger, saveThreadContext }) => {
  // const { channel_id, thread_ts, context: assistantContext } = event.assistant_thread;
  try {
    await saveThreadContext();
  } catch (e) {
    logger.error(e);
  }
};

/**
 * Messages sent from the user to the Assistant are handled in this listener.
 *
 * @see {@link https://docs.slack.dev/reference/events/message}
 */
export const userMessage = async ({ client, context, logger, message, getThreadContext, say, setTitle, setStatus }) => {
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
  const { userId, teamId } = context;

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
        recipient_team_id: teamId,
        recipient_user_id: userId,
        thread_ts: thread_ts,
      });

      for await (const chunk of llmResponse) {
        if (chunk.type === 'response.output_text.delta') {
          await streamer.append({
            markdown_text: chunk.delta,
          });
        }
      }
      await streamer.stop({ blocks: [feedbackBlock] });
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
      recipient_team_id: teamId,
      recipient_user_id: userId,
      thread_ts: thread_ts,
    });

    for await (const chunk of llmResponse) {
      if (chunk.type === 'response.output_text.delta') {
        await streamer.append({
          markdown_text: chunk.delta,
        });
      }
    }
    await streamer.stop({ blocks: [feedbackBlock] });
  } catch (e) {
    logger.error(e);

    // Send message to advise user and clear processing status if a failure occurs
    await say({ text: `Sorry, something went wrong! ${e}` });
  }
};
