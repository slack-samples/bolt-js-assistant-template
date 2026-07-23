import { callLLM } from '../../agent/llm-caller.js';
import { feedbackBlock } from '../views/feedback_block.js';

/**
 * Handles the event when the app is mentioned in a Slack conversation
 * and generates an AI response.
 *
 * @param {Object} params
 * @param {import("@slack/types").AppMentionEvent} params.event - The app mention event.
 * @param {import("@slack/web-api").WebClient} params.client - Slack web client.
 * @param {import("@slack/logger").Logger} params.logger - Logger instance.
 * @param {import("@slack/bolt").SayFn} params.say - Function to send messages.
 *
 * @see {@link https://docs.slack.dev/reference/events/app_mention/}
 */
export const appMentionCallback = async ({ event, client, logger, say }) => {
  try {
    const { channel, text, team, user } = event;
    const thread_ts = event.thread_ts || event.ts;

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

    const streamer = client.chatStream({
      channel: channel,
      recipient_team_id: team,
      recipient_user_id: user,
      thread_ts: thread_ts,
    });

    const prompts = [
      {
        role: 'user',
        content: text,
      },
    ];

    await callLLM(streamer, prompts);

    await streamer.stop({ blocks: [feedbackBlock] });
  } catch (e) {
    logger.error(`Failed to handle a user message event: ${e}`);
    await say(`:warning: Something went wrong! (${e})`);
  }
};
