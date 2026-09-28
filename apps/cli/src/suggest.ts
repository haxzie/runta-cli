import { logger } from '@runta/utils';

export interface NextStep {
  /** A complete, runnable command. Never the command that just ran. */
  command: string;
  /** Why you would run it. */
  why: string;
}

/**
 * Prints "next steps" after a command that leaves you mid-task.
 *
 * Always stderr, never stdout: these are advice for a human, and stdout has to stay parseable.
 * That also means they survive `--json` without polluting the payload — an agent that wants them
 * can read stderr, and one that doesn't gets clean data.
 *
 * Two rules worth keeping. First, never suggest the command that just ran: the production CLI's
 * `resume` returns `required_action: runta-next resume <name>`, which makes an agent following the
 * field loop (CLI_ISSUES.md C-11). Second, only ever name commands that exist — suggesting a
 * command the binary does not have is the same defect as its agent skill documenting
 * `runta-next agents ls` (C-30). `suggest.test.ts` asserts the second one against the real program.
 */
export function printNextSteps(steps: readonly NextStep[]): void {
  if (steps.length === 0) return;

  const pad = Math.max(...steps.map((step) => step.command.length));
  logger.info('');
  logger.info('Next steps:');
  for (const step of steps) {
    logger.info(`  ${step.command.padEnd(pad)}  ${step.why}`);
  }
}
