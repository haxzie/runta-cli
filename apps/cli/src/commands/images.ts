import {
  deleteRuntimeImage,
  listRuntimeImages,
  RuntaApiError,
  type RuntimeImage,
} from '@runta/api';
import { createContext } from '@runta/core';
import { type Column, fail, logger, renderTable } from '@runta/utils';
import type { Command } from 'commander';
import { outputOption, resolveOutput } from '../output.js';

export interface ImagesOptions {
  json?: boolean;
  output?: string;
  custom?: boolean;
}

export interface DeleteImageOptions {
  json?: boolean;
  output?: string;
  dryRun?: boolean;
  yes?: boolean;
}

export interface ImagesDeps {
  write: (text: string) => void;
}

/** `delete` is the only half that can ask a question, so only it carries the means to. */
export interface DeleteImageDeps extends ImagesDeps {
  /** Prompts for confirmation. Resolves false to abort. */
  confirm: (question: string) => Promise<boolean>;
  isInteractive: () => boolean;
}

export const defaultImagesDeps: DeleteImageDeps = {
  write: (text) => process.stdout.write(text),
  confirm: async (question) => {
    const { createInterface } = await import('node:readline/promises');
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try {
      return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
    } finally {
      rl.close();
    }
  },
  isInteractive: () => Boolean(process.stdin.isTTY && process.stderr.isTTY),
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
 * Deletes a custom image.
 *
 * Only images the organization built can go; the API answers 422 `invalid_argument` for a catalog
 * image. It answers the *same* 422 for an id that does not exist at all, so a typo and a built-in
 * are indistinguishable from the response — which is why this resolves the id against the catalog
 * first and says which of the two it is.
 */
export async function deleteImage(
  reference: string,
  options: DeleteImageOptions = {},
  deps: DeleteImageDeps = defaultImagesDeps,
): Promise<void> {
  const { client } = await createContext();

  const catalog = await request(() =>
    listRuntimeImages({ client, throwOnError: true }).then((r) => r.data.data),
  );
  const target = catalog.find((image) => image.id === reference || image.name === reference);

  if (!target) {
    fail(`No image named '${reference}'.`, {
      hint: 'List what exists with `runta-next image list`.',
      exitCode: 1,
    });
    return;
  }

  // Refuse before the request rather than relaying a 422 that names neither the image nor why.
  if (!target.is_custom) {
    fail(`'${target.id}' is a built-in image, and built-in images cannot be deleted.`, {
      hint: 'Only images your organization built can be deleted: `runta-next image list --custom`.',
      exitCode: 1,
    });
    return;
  }

  if (options.dryRun) {
    const plan = {
      action: 'image-delete',
      dry_run: true,
      image: { id: target.id, name: target.name },
    };
    if (options.json) {
      deps.write(`${JSON.stringify(plan, null, 2)}\n`);
      return;
    }
    deps.write(`Would delete custom image ${target.id} (${target.name}).\n`);
    return;
  }

  // Confirm only where a human can answer. Under --json or in a pipe a prompt would hang.
  if (!options.yes && !options.json && deps.isInteractive()) {
    const ok = await deps.confirm(`Delete custom image '${target.id}'? This cannot be undone.`);
    if (!ok) fail('Aborted.', { exitCode: 1 });
  }

  await request(() =>
    deleteRuntimeImage({ client, path: { image_id: target.id }, throwOnError: true }),
  );

  if (options.json) {
    deps.write(
      `${JSON.stringify(
        { action: 'image-delete', deleted: true, image: { id: target.id, name: target.name } },
        null,
        2,
      )}\n`,
    );
    return;
  }
  logger.success(`Deleted custom image ${target.id}.`);
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

/**
 * Noun-first only, with no top-level alias.
 *
 * Improvements.md I-2 gives top-level shortcuts to the *runtime* verbs alone, because those are
 * what you type all day; every other resource reads `runta-next <noun> <verb>` so that having seen
 * one, a reader can guess the rest. An earlier version of this shipped a flat `images`, which broke
 * that rule for the sake of one character.
 */
export function registerImages(program: Command): void {
  const group = program.command('image').description('Inspect and manage runtime images');

  group
    .command('list')
    .description('List the runtime images create can build from')
    .option('--custom', 'show only images built by your organization')
    .option('--json', 'print the images as JSON')
    .addOption(outputOption())
    .action(async (opts: ImagesOptions) => {
      await images(resolveOutput(opts));
    });

  group
    .command('delete')
    .description('Delete a custom runtime image')
    .argument('<image>', 'image id or name')
    .option('--dry-run', 'show what would be deleted and exit')
    .option('-y, --yes', 'skip the confirmation prompt')
    .option('--json', 'print the result as JSON')
    .addOption(outputOption())
    .action(async (reference: string, opts: DeleteImageOptions) => {
      await deleteImage(reference, resolveOutput(opts));
    });
}
