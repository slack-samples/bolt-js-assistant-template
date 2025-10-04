import { Assistant } from '@slack/bolt';
import { assistantThreadContextChanged } from './assistant_thread_context_changed.js';
import { assistantThreadStarted } from './assistant_thread_started.js';
import { message } from './message.js';

/**
 * @param {import("@slack/bolt").App} app
 */
export const register = (app) => {
  const assistant = new Assistant({
    threadStarted: assistantThreadStarted,
    threadContextChanged: assistantThreadContextChanged,
    userMessage: message,
  });

  app.assistant(assistant);
};
