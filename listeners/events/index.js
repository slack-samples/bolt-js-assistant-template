import { appMentionCallback } from './app_mention.js';

export const register = (app) => {
  app.event('app_mention', appMentionCallback);
};
