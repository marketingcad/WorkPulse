export type AiBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  /** Opaque pass-through: must be sent back to the provider unchanged. */
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'redacted_thinking'; data: string };

export interface AiMessage {
  role: 'user' | 'assistant';
  content: AiBlock[];
}

export interface AiToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type AiChunk =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'stop'; reason: 'end_turn' | 'tool_use' | 'max_tokens' }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'redacted_thinking'; data: string };

export const DEFAULT_ASSISTANT_MODEL = 'claude-sonnet-5-5';

export type AiErrorCode = 'ai_unavailable' | 'ai_rate_limited' | 'ai_bad_response';

const AI_ERROR_MESSAGES: Record<AiErrorCode, string> = {
  ai_unavailable: 'The AI service is unavailable.',
  ai_rate_limited: 'The AI service is busy. Try again shortly.',
  ai_bad_response: 'The AI service returned an unexpected response.',
};

/** Fixed message per code: never carries SDK text, headers or credentials. */
export class AiError extends Error {
  constructor(readonly code: AiErrorCode) {
    super(AI_ERROR_MESSAGES[code]);
    this.name = 'AiError';
  }
}

export interface AiTurnInput {
  system: string;
  messages: AiMessage[];
  tools: AiToolSpec[];
  /** 'none' keeps the tool definitions (needed when history holds tool blocks) but forbids new calls. */
  toolChoice?: 'auto' | 'none';
  maxTokens: number;
  signal: AbortSignal;
}

export interface AiProvider {
  readonly available: boolean;
  streamTurn(i: AiTurnInput): AsyncIterable<AiChunk>;
}
