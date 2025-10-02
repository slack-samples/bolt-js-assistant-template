/**
 * `feedback` action responds to the `feedbackBlock` that displays positive
 * and negative feedback icons. This block is attached to the bottom of
 * LLM responses using the `WebClient#chatStream.stop()` method.
 */
const handle_feedback = async ({ ack, body, client, logger }) => {
    try {
      await ack();
  
      if (body.type !== 'block_actions') {
        return;
      }
  
      const message_ts = body.message.ts;
      const channel_id = body.channel.id;
      const user_id = body.user.id;
  
      const feedback_type = body.actions[0];
      if (!('value' in feedback_type)) {
        return;
      }
  
      const is_positive = feedback_type.value === 'good-feedback';
      if (is_positive) {
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
  export { handle_feedback };
  