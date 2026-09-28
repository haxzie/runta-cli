/**
 * Polls the API while an agent works, so graders can see runtimes the agent created and then
 * deleted — T2 and T3 end with nothing left to inspect.
 */

import type { Api, RuntimeStatus } from './api.js';

export interface SeenRuntime {
  name: string;
  image_id: string;
  vcpus: number;
  memory_mib: number;
  /** Every status observed, in order, without repeats. */
  statuses: RuntimeStatus[];
}

export type Seen = Record<string, SeenRuntime>;

export function watch(api: Api, prefix: string, intervalMs = 4000): { stop: () => Promise<Seen> } {
  const seen: Seen = {};
  let running = true;
  let pollErrors = 0;

  const poll = async () => {
    try {
      for (const r of await api.listByPrefix(prefix)) {
        const s = seen[r.id] ?? {
          name: r.display_name,
          image_id: r.image_id,
          vcpus: r.resources.requests.vcpus,
          memory_mib: r.resources.requests.memory_mib,
          statuses: [],
        };
        seen[r.id] = s;
        if (s.statuses.at(-1) !== r.status) s.statuses.push(r.status);
      }
    } catch {
      pollErrors++;
    }
  };

  const loop = (async () => {
    while (running) {
      await poll();
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  })();

  return {
    async stop() {
      running = false;
      await loop;
      await poll();
      if (pollErrors > 0) console.warn(`  watcher: ${pollErrors} poll(s) failed for ${prefix}`);
      return seen;
    },
  };
}
