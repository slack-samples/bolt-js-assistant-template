const actions = require('./actions/index.js');
const events = require('./events/index.js');
const assistant = require('./assistant/index.js');

export const registerListeners = (app) => {
  actions.register(app);
  events.register(app);
  assistant.register(app);
};

module.exports = { registerListeners };