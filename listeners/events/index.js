const { handleAppMention } = require('./app_mentioned.js');

export const register = (app) => {
  app.event('app_mention', handleAppMention);
};
