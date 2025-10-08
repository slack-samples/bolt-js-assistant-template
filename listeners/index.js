import * as actions from './actions/index.js';
import * as assistant from './assistant/index.js';
import * as events from './events/index.js';

/**
 * @param {import("@slack/bolt").App} app
 */
export const registerListeners = (app) => {
  actions.register(app);
  events.register(app);
  assistant.register(app);
};
