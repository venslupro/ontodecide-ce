/**
 * @fileoverview Registry of ontology packs: built-in packs shipped with the
 * platform plus packs a tenant imported inline.
 */

import type {OntologyPack, PackSummary} from '../contract';
import {SUPPLY_CHAIN_PACK} from './packs/supply_chain';

/** Packs shipped with the platform. */
export const BUILT_IN_PACKS: readonly OntologyPack[] = [SUPPLY_CHAIN_PACK];

/** Summarizes a pack for listings. */
export function packSummary(pack: OntologyPack, builtIn: boolean): PackSummary {
  return {
    id: pack.id,
    name: pack.name,
    version: pack.version,
    ...(pack.description !== undefined ? {description: pack.description} : {}),
    builtIn,
  };
}

/** Looks packs up across built-in and tenant packs (built-ins win). */
export class PackRegistry {
  private readonly builtIns: Map<string, OntologyPack>;

  constructor(builtIns: readonly OntologyPack[] = BUILT_IN_PACKS) {
    this.builtIns = new Map(builtIns.map(p => [p.id, p]));
  }

  /** Whether the id belongs to a built-in pack. */
  isBuiltIn(id: string): boolean {
    return this.builtIns.has(id);
  }

  /** Returns a built-in pack by id. */
  builtIn(id: string): OntologyPack | undefined {
    return this.builtIns.get(id);
  }

  /** Lists built-in packs followed by tenant packs not shadowed by one. */
  list(tenantPacks: readonly OntologyPack[]): PackSummary[] {
    return [
      ...[...this.builtIns.values()].map(p => packSummary(p, true)),
      ...tenantPacks
        .filter(p => !this.builtIns.has(p.id))
        .map(p => packSummary(p, false)),
    ];
  }

  /** Finds a pack whose schema has the given api name. */
  findBySchema(
    api: string,
    tenantPacks: readonly OntologyPack[],
  ): OntologyPack | undefined {
    return (
      [...this.builtIns.values()].find(p => p.schema.apiName === api) ??
      tenantPacks.find(p => p.schema.apiName === api)
    );
  }
}
