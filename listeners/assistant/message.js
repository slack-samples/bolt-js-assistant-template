import { callLLM } from '../../agent/llm-caller.js';
import { feedbackBlock } from '../views/feedback_block.js';

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Handles when users send messages or select a prompt in an assistant thread
 * and generate AI responses.
 *
 * @param {Object} params
 * @param {import("@slack/logger").Logger} params.logger - Logger instance.
 * @param {import("@slack/types").MessageEvent} params.message - The incoming message.
 * @param {import("@slack/bolt").SayFn} params.say - Function to send messages.
 * @param {import("@slack/bolt").SayStreamFn} params.sayStream - Function to start a chat stream.
 * @param {Function} params.setStatus - Function to set assistant status.
 *
 * @see {@link https://docs.slack.dev/reference/events/message}
 */
export const message = async ({ logger, message, say, sayStream, setStatus }) => {
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
    // The first example shows a message with thinking steps that has different chunks to construct and update a plan alongside text outputs.
    if (message.text === 'Wonder a few deep thoughts.') {
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

      await sleep(4000);

      const streamer = sayStream({
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
            text: 'The crowd appears to be astounded and applauds :popcorn:',
          },
        ],
        blocks: [feedbackBlock],
      });
    } else {
      // This second example shows a generated text response for the provided prompt
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

      const streamer = sayStream({
        task_display_mode: 'timeline',
      });

      const prompts = [
        {
          role: 'user',
          content: message.text,
        },
      ];

      await callLLM(streamer, prompts);
      await streamer.stop({ blocks: [feedbackBlock] });
    }
  } catch (e) {
    logger.error(`Failed to handle a user message event: ${e}`);
    await say(`:warning: Something went wrong! (${e})`);
  }
};
