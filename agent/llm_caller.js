import { OpenAI } from 'openai';
import { rollDice, rollDiceDefinition } from './tools/dice.js';

// OpenAI LLM client
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Stream an LLM response to prompts with an example dice rolling function
 *
 * @param {import("@slack/web-api").ChatStream} streamer - Slack chat stream
 * @param {Array} prompts - OpenAI ResponseInputParam messages
 *
 * @see {@link https://docs.slack.dev/tools/bolt-js/web#sending-streaming-messages}
 * @see {@link https://platform.openai.com/docs/guides/text}
 * @see {@link https://platform.openai.com/docs/guides/streaming-responses}
 * @see {@link https://platform.openai.com/docs/guides/function-calling}
 */
export async function callLlm(streamer, prompts) {
  const toolCalls = [];

  const response = await openai.responses.create({
    model: 'gpt-4o-mini',
    input: prompts,
    tools: [rollDiceDefinition],
    tool_choice: 'auto',
    stream: true,
  });

  for await (const event of response) {
    // Stream markdown text from the LLM response as it arrives
    if (event.type === 'response.output_text.delta' && event.delta) {
      await streamer.append({
        markdown_text: event.delta,
      });
    }

    // Save function calls for later computation and a new task is shown
    if (event.type === 'response.output_item.done') {
      if (event.item.type === 'function_call') {
        toolCalls.push(event.item);

        if (event.item.name === 'roll_dice') {
          const args = JSON.parse(event.item.arguments);
          await streamer.append({
            chunks: [
              {
                type: 'task_update',
                id: event.item.call_id,
                title: `Rolling a ${args.count}d${args.sides}...`,
                status: 'in_progress',
              },
            ],
          });
        }
      }
    }
  }

  // Perform tool calls and marks tasks as completed
  if (toolCalls.length > 0) {
    for (const call of toolCalls) {
      if (call.name === 'roll_dice') {
        const args = JSON.parse(call.arguments);

        prompts.push({
          id: call.id,
          call_id: call.call_id,
          type: 'function_call',
          name: 'roll_dice',
          arguments: call.arguments,
        });

        const result = rollDice(args);

        prompts.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: JSON.stringify(result),
        });

        if (result.error != null) {
          await streamer.append({
            chunks: [
              {
                type: 'task_update',
                id: call.call_id,
                title: result.error,
                status: 'error',
              },
            ],
          });
        } else {
          await streamer.append({
            chunks: [
              {
                type: 'task_update',
                id: call.call_id,
                title: result.description,
                status: 'complete',
              },
            ],
          });
        }
      }
    }

    // complete the llm response after making tool calls
    await callLlm(streamer, prompts);
  }
}
