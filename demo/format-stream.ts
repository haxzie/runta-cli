#!/usr/bin/env bun
/**
 * Renders Claude Code's `--output-format stream-json` as a readable live trace.
 *
 * The eval stores the raw JSONL for grading; this is the same stream shown to a person. It prints
 * what the agent said, every command it ran, whether that command failed, and the final answer —
 * and nothing else, so a recording stays legible.
 *
 *   claude -p "…" --output-format stream-json --verbose … | bun demo/format-stream.ts
 */
const DIM = '\x1b[90m';
const BOLD = '\x1b[1m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const OFF = '\x1b[0m';

/** Tool input is shaped per tool; Bash is the only one whose argument is worth showing in full. */
function describeTool(name: string, input: Record<string, unknown>): string {
  if (name === 'Bash') return String(input.command ?? '');
  const path = input.file_path ?? input.path ?? input.pattern ?? '';
  return path ? `${name} ${path}` : name;
}

const wrap = (text: string, width = 96): string =>
  text
    .split('\n')
    .flatMap((line) => line.match(new RegExp(`.{1,${width}}`, 'g')) ?? [''])
    .join('\n');

let buffer = '';
process.stdin.setEncoding('utf8');

for await (const chunk of process.stdin) {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';

  for (const line of lines) {
    if (!line.trim()) continue;
    let event: Record<string, any>;
    try {
      event = JSON.parse(line);
    } catch {
      continue; // A partial or non-JSON line; the next chunk completes it.
    }

    if (event.type === 'assistant') {
      for (const block of event.message?.content ?? []) {
        if (block.type === 'text' && block.text?.trim()) {
          console.log(`${DIM}│${OFF} ${wrap(block.text.trim())}\n`);
        }
        if (block.type === 'tool_use') {
          console.log(`${CYAN}▸${OFF} ${BOLD}${describeTool(block.name, block.input ?? {})}${OFF}`);
        }
      }
    }

    // Only failures are worth showing: a successful command's output is the CLI's own, and the
    // recording is about what the agent does with it, not a second copy of it.
    if (event.type === 'user') {
      for (const block of event.message?.content ?? []) {
        if (block.type === 'tool_result' && block.is_error) {
          const text = typeof block.content === 'string' ? block.content : '';
          console.log(`${RED}  ✗ ${wrap(text.split('\n').slice(0, 6).join('\n'))}${OFF}`);
        }
      }
    }

    if (event.type === 'result') {
      const turns = event.num_turns ?? '?';
      const cost = typeof event.total_cost_usd === 'number' ? event.total_cost_usd.toFixed(2) : '?';
      console.log(`\n${DIM}── ${turns} turns · $${cost}${OFF}`);
    }
  }
}
