import { feedbackActionCallback } from './feedback.js';

export const register = (app) => {
  app.action('feedback', feedbackActionCallback);
};
