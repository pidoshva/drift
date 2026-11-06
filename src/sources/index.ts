// Registry: builds the enabled sources from config. Add new adapters here.
import { Config } from '../core/config.js';
import { KslClient } from './ksl/client.js';
import { KslSource } from './ksl/index.js';
import { ManualSource } from './manual.js';
import { InventorySource } from './source.js';

export function buildSources(config: Config, only?: string): InventorySource[] {
  const sources: InventorySource[] = [];
  if (config.sources.ksl.enabled && (!only || only === 'ksl')) {
    sources.push(new KslSource({
      memberId: config.sources.ksl.memberId,
      maxPages: config.sources.ksl.maxPages,
      client: new KslClient({ delayMs: config.sources.ksl.requestDelayMs }),
    }));
  }
  if (config.sources.manual.enabled && (!only || only === 'manual')) sources.push(new ManualSource());
  return sources;
}
