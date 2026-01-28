/**
 * Roll one or more dice with a specified number of sides.
 *
 * @param {Object} options - The roll options
 * @param {number} [options.sides=6] - The number of sides on the die
 * @param {number} [options.count=1] - The number of dice to roll
 * @returns {Object} The roll results with rolls array, total, and description
 */
export function rollDice({ sides = 6, count = 1 } = {}) {
  if (sides < 2) {
    return {
      error: 'A die must have at least 2 sides',
      rolls: [],
      total: 0,
    };
  }

  if (count < 1) {
    return {
      error: 'Must roll at least 1 die',
      rolls: [],
      total: 0,
    };
  }

  const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
  const total = rolls.reduce((sum, roll) => sum + roll, 0);

  return {
    rolls,
    total,
    description: `Rolled a ${count}d${sides} to total ${total}`,
  };
}

/**
 * Tool definition for OpenAI API
 *
 * @type {import('openai/resources/responses/responses').Tool}
 * @see {@link https://platform.openai.com/docs/guides/function-calling}
 */
export const rollDiceDefinition = {
  type: 'function',
  name: 'roll_dice',
  description:
    'Roll one or more dice with a specified number of sides. Use this when the user wants to roll dice or generate random numbers within a range.',
  parameters: {
    type: 'object',
    properties: {
      sides: {
        type: 'integer',
        description: 'The number of sides on the die (e.g., 6 for a standard die, 20 for a d20)',
        default: 6,
      },
      count: {
        type: 'integer',
        description: 'The number of dice to roll',
        default: 1,
      },
    },
    required: ['sides', 'count'],
  },
  strict: false,
};
