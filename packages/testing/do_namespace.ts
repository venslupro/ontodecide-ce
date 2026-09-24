/**
 * @fileoverview Fake DurableObjectNamespace: one instance per name, created
 * lazily by a factory; stubs expose the instance's methods through an RPC
 * emulation.
 */

import {rpcBinding} from './rpc_binding';

/** Fake namespace keyed by `idFromName`. */
export class FakeDoNamespace<T extends object> {
  readonly instances = new Map<string, T>();

  constructor(private readonly factory: (name: string) => T) {}

  idFromName(name: string): DurableObjectId {
    return {
      toString: () => name,
      name,
      equals: () => false,
    } as unknown as DurableObjectId;
  }

  get(id: DurableObjectId): T {
    const name = String(id);
    return rpcBinding(() => this.instance(name));
  }

  getByName(name: string): T {
    return this.get(this.idFromName(name));
  }

  /** Direct access to the underlying instance. */
  instance(name: string): T {
    let inst = this.instances.get(name);
    if (!inst) {
      inst = this.factory(name);
      this.instances.set(name, inst);
    }
    return inst;
  }

  /** Returns this as the Workers DurableObjectNamespace type. */
  asNamespace(): DurableObjectNamespace {
    return this as unknown as DurableObjectNamespace;
  }
}
