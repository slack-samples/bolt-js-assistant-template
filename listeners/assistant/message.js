import { callLlm } from '../../agent/llm_caller.js';
import { feedbackBlock } from '../views/feedback_block.js';

/**
 * Helper function to pause execution for a specified duration.
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Handles when users send messages or select a prompt in an assistant thread
 * and generate AI responses.
 *
 * @param {Object} params
 * @param {import("@slack/web-api").WebClient} params.client - Slack web client.
 * @param {import("@slack/bolt").Context} params.context - Event context.
 * @param {import("@slack/logger").Logger} params.logger - Logger instance.
 * @param {import("@slack/types").MessageEvent} params.message - The incoming message.
 * @param {import("@slack/bolt").SayFn} params.say - Function to send messages.
 * @param {Function} params.setStatus - Function to set assistant status.
 *
 * @see {@link https://docs.slack.dev/reference/events/message}
 */
export const message = async ({ client, context, logger, message, say, setStatus }) => {
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

  try {
    const { channel, thread_ts } = message;
    const { userId, teamId } = context;

    // This first example shows a generated text response for the provided prompt
    if (message.text !== 'Wonder a few deep thoughts.') {
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

      const streamer = client.chatStream({
        channel: channel,
        recipient_team_id: teamId,
        recipient_user_id: userId,
        thread_ts: thread_ts,
        task_display_mode: 'timeline',
      });

      const prompts = [
        {
          role: 'user',
          content: message.text,
        },
      ];

      await callLlm(streamer, prompts);

      await streamer.stop({ blocks: [feedbackBlock] });
    } else {
      // The second example shows detailed thinking steps similar to tool calls
      const streamer = client.chatStream({
        channel: channel,
        recipient_team_id: teamId,
        recipient_user_id: userId,
        thread_ts: thread_ts,
        task_display_mode: 'plan',
      });

      await streamer.append({
        chunks: [
          {
            type: 'markdown_text',
            text: 'Hello.\nI have received the task. ',
          },
          {
            type: 'markdown_text',
            text: 'This task appears manageable.\nThat is good.',
          },
          {
            type: 'task_update',
            id: '001',
            title: 'Understanding the task...',
            status: 'in_progress',
            details: '- Identifying the goal\n- Identifying constraints',
          },
          {
            type: 'task_update',
            id: '002',
            title: 'Performing acrobatics...',
            status: 'pending',
          },
        ],
      });

      await sleep(4000);

      await streamer.append({
        chunks: [
          {
            type: 'plan_update',
            title: 'Adding the final pieces...',
          },
          {
            type: 'task_update',
            id: '001',
            title: 'Understanding the task...',
            status: 'complete',
            details: '\n- Pretending this was obvious',
            output: "We'll continue to ramble now",
          },
          {
            type: 'task_update',
            id: '002',
            title: 'Performing acrobatics...',
            status: 'in_progress',
          },
        ],
      });

      await sleep(4000);

      await streamer.stop({
        chunks: [
          {
            type: 'plan_update',
            title: 'Decided to put on a show',
          },
          {
            type: 'task_update',
            id: '002',
            title: 'Performing acrobatics...',
            status: 'complete',
            details: '- Jumped atop ropes\n- Juggled bowling pins\n- Rode a single wheel too',
          },
          {
            type: 'markdown_text',
            text: 'The crowd appears to be astouned and applauds :popcorn:',
          },
        ],
      });
    }
  } catch (e) {
    logger.error(`Failed to handle a user message event: ${e}`);
    await say(`:warning: Something went wrong! (${e})`);
  }
};
