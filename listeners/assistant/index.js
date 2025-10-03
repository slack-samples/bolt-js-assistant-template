import { Assistant } from '@slack/bolt';
import { threadContextChanged, threadStarted, userMessage } from './assistant.js';

export const register = (app) => {
  const assistant = new Assistant({
    threadStarted: threadStarted,
    threadContextChanged: threadContextChanged,
    userMessage: userMessage,
  });

  app.assistant(assistant);
};
