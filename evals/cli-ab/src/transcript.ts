/**
 * Turns a `claude -p --output-format stream-json` transcript into metrics.
 */

import { invokesCli } from './tasks.js';

export interface ToolCall {
  command: string;
  output: string;
  isError: boolean;
}

export interface TranscriptMetrics {
  /** The final message, from the `result` event. */
  result: string;
  answer: string;
  /** How the session ended: `success`, `error_max_turns`, `error_max_budget_usd`, … */
  stopReason: string;
  numTurns: number;
  durationMs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  bashCalls: ToolCall[];
  cliCalls: number;
  /** CLI calls whose Bash result was an error — usually a non-zero exit. */
  cliErrors: number;
  helpCalls: number;
  /** Characters of CLI output the agent read. Tokens are roughly a quarter of this. */
  cliOutputChars: number;
}

type Content = { type: string; [k: string]: unknown };

function text(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c: Content) => (typeof c.text === 'string' ? c.text : '')).join('');
  }
  return '';
}

export function extractAnswer(result: string): string {
  const matches = [...result.matchAll(/^\s*\**ANSWER:?\**:?\s*(.*)$/gim)];
  const last = matches.at(-1)?.[1];
  return (last ?? result).trim().replace(/^`|`$/g, '').trim();
}

export function parseTranscript(ndjson: string, cli: string): TranscriptMetrics {
  const calls = new Map<string, ToolCall>();
  const order: string[] = [];
  let final: Record<string, unknown> | undefined;

  for (const line of ndjson.split('\n')) {
    if (!line.trim()) continue;
    let event: { type?: string; message?: { content?: unknown }; [k: string]: unknown };
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const content = Array.isArray(event.message?.content)
      ? (event.message.content as Content[])
      : [];
    if (event.type === 'assistant') {
      for (const c of content) {
        if (c.type === 'tool_use' && c.name === 'Bash') {
          const id = String(c.id);
          const input = c.input as { command?: string } | undefined;
          calls.set(id, { command: input?.command ?? '', output: '', isError: false });
          order.push(id);
        }
      }
    } else if (event.type === 'user') {
      for (const c of content) {
        const call = c.type === 'tool_result' ? calls.get(String(c.tool_use_id)) : undefined;
        if (call) {
          call.output = text(c.content);
          call.isError = c.is_error === true;
        }
      }
    } else if (event.type === 'result') {
      final = event;
    }
  }

  const bashCalls = order.flatMap((id) => calls.get(id) ?? []);
  const cliCalls = bashCalls.filter((c) => invokesCli(c.command, cli));
  const usage = (final?.usage ?? {}) as Record<string, number>;
  const result = typeof final?.result === 'string' ? final.result : '';

  return {
    result,
    answer: extractAnswer(result),
    stopReason: String(final?.subtype ?? 'no_result_event'),
    numTurns: Number(final?.num_turns ?? 0),
    durationMs: Number(final?.duration_ms ?? 0),
    costUsd: Number(final?.total_cost_usd ?? 0),
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
    bashCalls,
    cliCalls: cliCalls.length,
    cliErrors: cliCalls.filter((c) => c.isError).length,
    helpCalls: cliCalls.filter((c) => /(\s--help\b|\s-h\b|\shelp\b)/.test(c.command)).length,
    cliOutputChars: cliCalls.reduce((n, c) => n + c.output.length, 0),
  };
}
