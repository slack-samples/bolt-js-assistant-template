const { openai, DEFAULT_SYSTEM_CONTENT } = require('../../app.js');

/**
 * `app_mention` event allows your app to receive message events that directly
 * mention your app. The app must be a member of the channel/conversation to
 * receive the event. Messages in a DM with your app will not dispatch this event,
 * event if the message mentions your app.
 *
 * @see {@link https://docs.slack.dev/reference/events/app_mention/}
 */
const handleAppMention = async ({ event, client, logger, say }) => {
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
};
export { handleAppMention };
