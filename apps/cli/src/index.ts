#!/usr/bin/env node
import { isCliError, logger } from '@runta/utils';
import { buildProgram } from './program.js';

async function main(): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  if (isCliError(error)) {
    logger.error(error.message);
    if (error.hint) logger.info(error.hint);
    process.exit(error.exitCode);
  }
  logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});
