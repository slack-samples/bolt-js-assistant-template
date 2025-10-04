import { feedbackActionCallback } from './feedback.js';

/**
 * @param {import("@slack/bolt").App} app
 */
export const register = (app) => {
  app.action('feedback', feedbackActionCallback);
};
