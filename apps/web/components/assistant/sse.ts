import { assistantStreamEvent, type AssistantStreamEvent } from '@tallywork/contracts/assistant';

/**
 * Incremental parser for the assistant's server-sent events. Chunks may split an event anywhere;
 * complete events are validated against the contract and anything unknown or malformed is skipped.
 */
export function createSseParser(onEvent: (e: AssistantStreamEvent) => void): (chunk: string) => void {
  let buffer = '';
  return (chunk) => {
    buffer += chunk.replace(/\r\n?/g, '\n');
    let end = buffer.indexOf('\n\n');
    while (end !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      emit(block, onEvent);
      end = buffer.indexOf('\n\n');
    }
  };
}

function emit(block: string, onEvent: (e: AssistantStreamEvent) => void) {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  if (!data.length) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.join('\n'));
  } catch {
    return;
  }
  const r = assistantStreamEvent.safeParse({ event, data: parsed });
  if (r.success) onEvent(r.data);
}
