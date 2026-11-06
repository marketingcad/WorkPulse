import { AnthropicProvider } from './anthropic';
import { FakeProvider } from './fake';
import { AiError, DEFAULT_ASSISTANT_MODEL, type AiChunk, type AiProvider } from './provider';

export * from './provider';
export { AnthropicProvider } from './anthropic';
export { FakeProvider } from './fake';

/** Used in production when no key is configured: reports unavailable and refuses to stream. */
class UnavailableProvider implements AiProvider {
  readonly available = false;
  // eslint-disable-next-line require-yield
  async *streamTurn(): AsyncIterable<AiChunk> {
    throw new AiError('ai_unavailable');
  }
}

/** The API key is read here only; it is never stored in Config. */
export function createAiProvider(env: Record<string, string | undefined> = process.env): AiProvider {
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (key && env.ASSISTANT_ENABLED !== 'false') return new AnthropicProvider(key, env.ASSISTANT_MODEL || DEFAULT_ASSISTANT_MODEL);
  // The E2E server is a production build; it opts into the deterministic fake with both flags,
  // which e2e/scripts/serve-web.mjs alone sets. A real deployment never has them.
  if (env.ASSISTANT_FAKE === '1' && env.TALLYWORK_E2E === '1') return new FakeProvider();
  if (env.NODE_ENV === 'production') return new UnavailableProvider();
  return new FakeProvider();
}
