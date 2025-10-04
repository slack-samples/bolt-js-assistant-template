/**
 * The `feedbackActionCallback` action responds to the `feedbackBlock` that displays
 * positive and negative feedback icons. This block is attached to the bottom of LLM
 * responses using the `WebClient#chatStream.stop()` method.
 *
 * @param {Object} params
 * @param {import("@slack/bolt").AckFn<any>} params.ack - Acknowledgement function.
 * @param {import("@slack/bolt").SlackAction} params.body - Action payload.
 * @param {import("@slack/web-api").WebClient} params.client - Slack web client.
 * @param {import("@slack/logger").Logger} params.logger - Logger instance.
 */
export const feedbackActionCallback = async ({ ack, body, client, logger }) => {
  try {
    await ack();

    if (body.type !== 'block_actions' || body.actions[0].type !== 'feedback_buttons') {
      return;
    }

    const message_ts = body.message.ts;
    const channel_id = body.channel.id;
    const user_id = body.user.id;
    const value = body.actions[0].value;

    if (value === 'good-feedback') {
      await client.chat.postEphemeral({
        channel: channel_id,
        user: user_id,
        thread_ts: message_ts,
        text: "We're glad you found this useful.",
      });
    } else {
      await client.chat.postEphemeral({
        channel: channel_id,
        user: user_id,
        thread_ts: message_ts,
        text: "Sorry to hear that response wasn't up to par :slightly_frowning_face: Starting a new chat may help with AI mistakes and hallucinations.",
      });
    }
  } catch (error) {
    logger.error(`:warning: Something went wrong! ${error}`);
  }
};
