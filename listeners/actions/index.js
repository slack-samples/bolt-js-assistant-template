const { handle_feedback } = require('./feedback.js');

export const register = (app) => {
  app.action('feedback', handle_feedback);
};
