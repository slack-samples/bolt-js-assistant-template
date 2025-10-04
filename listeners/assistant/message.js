import { DEFAULT_SYSTEM_CONTENT, openai } from '../../ai/index.js';
import { feedbackBlock } from '../views/feedback_block.js';

/**
 * The `message` event is sent when the user direct messages the app in a DM or Assistant container.
 *
 * @param {Object} params
 * @param {import("@slack/web-api").WebClient} params.client - Slack web client.
 * @param {import("@slack/bolt").Context} params.context - Event context.
 * @param {import("@slack/logger").Logger} params.logger - Logger instance.
 * @param {import("@slack/types").MessageEvent} params.message - The incoming message.
 * @param {Function} params.getThreadContext - Function to get thread context.
 * @param {import("@slack/bolt").SayFn} params.say - Function to send messages.
 * @param {Function} params.setTitle - Function to set assistant thread title.
 * @param {Function} params.setStatus - Function to set assistant status.
 *
 * @see {@link https://docs.slack.dev/reference/events/message}
 */
export const message = async ({ client, context, logger, message, getThreadContext, say, setTitle, setStatus }) => {
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
