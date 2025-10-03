/**
 * `assistant_thread_started` is sent when a user opens the Assistant container.
 * This can happen via DM with the app or as a side-container within a channel.
 *
 * @see {@link https://docs.slack.dev/reference/events/assistant_thread_started}
 */
export const assistantThreadStarted = async ({ event, logger, say, setSuggestedPrompts, saveThreadContext }) => {
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
