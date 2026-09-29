import { listRuntimeImages, RuntaApiError, type RuntimeImage } from '@runta/api';
import { createContext } from '@runta/core';
import { type Column, fail, logger, renderTable } from '@runta/utils';
import type { Command } from 'commander';
import { outputOption, resolveOutput } from '../output.js';

export interface ImagesOptions {
  json?: boolean;
  output?: string;
  custom?: boolean;
}

export interface ImagesDeps {
  write: (text: string) => void;
}

export const defaultImagesDeps: ImagesDeps = {
  write: (text) => process.stdout.write(text),
};

/**
 * The image catalog, which `create --image` takes ids from and nothing else could tell you.
 *
 * The official CLI's `image ls` lists only images you built yourself, so the thirteen built-in
 * ids — `claude`, `codex`, `clean` … — are reachable through the Dashboard or a raw API call and
 * nowhere else. `create --image <id>` is otherwise a flag whose valid values are undiscoverable.
 */
export async function images(
  options: ImagesOptions = {},
  deps: ImagesDeps = defaultImagesDeps,
): Promise<void> {
  const { client, config } = await createContext();
  logger.debug(`calling ${config.apiUrl}/v2/images`);

  const catalog = await request(() =>
    listRuntimeImages({ client, throwOnError: true }).then((r) => r.data.data),
  );

  const list = options.custom ? catalog.filter((image) => image.is_custom) : catalog;

  if (options.json) {
    // The API's own objects, unprojected — `protocol_bindings` and `subscription_options` carry
    // the detail the table has to compress, and an agent picking an image needs them.
    deps.write(`${JSON.stringify(list, null, 2)}\n`);
    return;
  }

  if (list.length === 0) {
    // Only reachable under --custom: the built-in catalog is never empty.
    deps.write('No custom images. Build one with the official CLI: `runta image build`.\n');
    return;
  }

  deps.write(`${renderTable(list, COLUMNS)}\n`);
}

/**
 * What you need to choose an image, and nothing that would crowd out the id.
 *
 * Disk is deliberately absent: every catalog image defaults to the same 32 GiB, so the column
 * would be a constant stealing width from `ID`, which is the one cell a reader has to copy
 * verbatim into `create --image`. `--json` still carries it.
 */
const COLUMNS: Column[] = [
  { header: 'ID', value: (i: RuntimeImage) => i.id },
  { header: 'NAME', value: (i: RuntimeImage) => i.name },
  {
    header: 'VCPUS',
    value: (i: RuntimeImage) => String(i.recommended_resources.vcpus),
    align: 'right',
  },
  {
    header: 'MEMORY',
    value: (i: RuntimeImage) => String(i.recommended_resources.memory_mib),
    align: 'right',
  },
  { header: 'MODEL PROVIDER', value: (i: RuntimeImage) => providerOf(i) },
  { header: 'KIND', value: (i: RuntimeImage) => kindOf(i) },
] as Column[];

/**
 * The column that answers "will `create` ask me for `--model-provider-protocol`?".
 *
 * One binding is inferred, so naming it is free information. Several means the flag is mandatory
 * and the choice is yours — and the names are long enough that listing three would truncate the
 * id column, so the count points at `--json` instead of half-printing them.
 */
function providerOf(image: RuntimeImage): string | undefined {
  const protocols = (image.model_provider?.protocol_bindings ?? [])
    .map((binding) => binding.protocol)
    .filter((protocol): protocol is string => Boolean(protocol));

  if (protocols.length === 0) return undefined;
  if (protocols.length === 1) return protocols[0];
  return `${protocols.length} protocols`;
}

/** `default` is what `create` uses with no `--image`; `custom` is one you built. */
function kindOf(image: RuntimeImage): string | undefined {
  if (image.is_default) return 'default';
  if (image.is_custom) return 'custom';
  return undefined;
}

async function request<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof RuntaApiError) {
      fail(error.message, { exitCode: exitCodeFor(error), hint: hintFor(error), cause: error });
    }
    throw error;
  }
}

const exitCodeFor = (error: RuntaApiError): number =>
  error.status === 401 || error.status === 403 ? 2 : 1;

function hintFor(error: RuntaApiError): string | undefined {
  if (error.status === 401)
    return 'The token was rejected. Run `runta-next login` to get a new one.';
  if (error.status === 403)
    return 'No credential was sent, or it lacks permission. Run `runta-next login`.';
  if (error.status >= 500)
    return 'The Runta API is having trouble — this is usually transient. Try again.';
  return undefined;
}

export function registerImages(program: Command): void {
  program
    .command('images')
    .description('List the runtime images create can build from')
    .option('--custom', 'show only images built by your organization')
    .option('--json', 'print the images as JSON')
    .addOption(outputOption())
    .action(async (opts: ImagesOptions) => {
      await images(resolveOutput(opts));
    });
}
