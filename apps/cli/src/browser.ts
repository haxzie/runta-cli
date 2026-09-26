import { spawn } from 'node:child_process';

/**
 * Opens a URL in the user's browser, resolving to whether it worked.
 *
 * The production CLI prints three copy-paste commands — macOS, Linux *and* Windows — on a
 * machine whose platform it already knows, and one of those platforms has no binary
 * (CLI_ISSUES.md C-21). We just open it, and fall back to printing the URL.
 */
export async function openUrl(url: string): Promise<boolean> {
  const command = openerFor(process.platform);
  if (!command) return false;

  return await new Promise<boolean>((resolve) => {
    const child = spawn(command.program, [...command.args, url], {
      stdio: 'ignore',
      detached: true,
    });
    child.on('error', () => resolve(false));
    // Nothing useful comes back from the opener, and waiting on it would block until the
    // browser exits on some platforms. A successful spawn is as much as we can know.
    child.on('spawn', () => {
      child.unref();
      resolve(true);
    });
  });
}

function openerFor(platform: NodeJS.Platform): { program: string; args: string[] } | undefined {
  if (platform === 'darwin') return { program: 'open', args: [] };
  if (platform === 'win32') return { program: 'cmd', args: ['/c', 'start', ''] };
  if (platform === 'linux') return { program: 'xdg-open', args: [] };
  return undefined;
}

/**
 * True when we should not try to hijack a browser: no interactive terminal, or a remote
 * shell where the browser would open on the wrong machine.
 */
export const canOpenBrowser = (): boolean =>
  Boolean(process.stdout.isTTY) && !process.env.SSH_CONNECTION && !process.env.SSH_TTY;
