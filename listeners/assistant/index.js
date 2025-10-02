const { threadStarted, threadContextChanged, userMessage } = require('./assistant.js');

export const register = (app) => {
  app.Assistant(threadStarted);
  app.Assistant(threadContextChanged);
  app.Assistant(userMessage);
};
