/**
 * Ontology domain entity.
 *
 * Represents a tenant's definition of an entity type (e.g. "asset",
 * "vulnerability") and the relations that may connect instances of that
 * type to others. Invariants:
 *   - property and relation keys must match `[a-zA-Z][a-zA-Z0-9_]*`;
 *   - the ontology id is unique within a tenant.
 */
import {ERROR_CODES, throwError} from '@ontodecide/shared';
import type {OntologyType} from '@ontodecide/shared';

const IDENT_RE = /^[a-zA-Z][a-zA-Z0-9_]{1,62}$/;

export class Ontology implements OntologyType {
  public readonly id: string;
  public readonly name: string;
  public readonly properties: readonly string[];
  public readonly relations: readonly string[];
  public readonly createdAt?: string;

  private constructor(type: OntologyType) {
    this.id = type.id;
    this.name = type.name;
    this.properties = Object.freeze([...type.properties]);
    this.relations = Object.freeze([...type.relations]);
    this.createdAt = type.created_at;
  }

  /** Construct an Ontology from raw input, validating all invariants. */
  public static fromInput(type: OntologyType): Ontology {
    if (!IDENT_RE.test(type.id)) {
      throwError(ERROR_CODES.VALIDATION_FAILED, `Invalid ontology id: ${type.id}`);
    }
    if (!type.name || type.name.length > 80) {
      throwError(ERROR_CODES.VALIDATION_FAILED, 'Ontology name is required (max 80 chars).');
    }
    for (const prop of type.properties) {
      if (!IDENT_RE.test(prop)) {
        throwError(ERROR_CODES.VALIDATION_FAILED, `Invalid property name: ${prop}`);
      }
    }
    for (const rel of type.relations) {
      // Relations use UPPER_SNAKE_CASE to mirror Cypher conventions.
      if (!/^[A-Z][A-Z0-9_]{1,62}$/.test(rel)) {
        throwError(ERROR_CODES.VALIDATION_FAILED, `Invalid relation name: ${rel}`);
      }
    }
    return new Ontology(type);
  }

  /** Serialise back to the plain shape used by storage/JSON. */
  public toType(): OntologyType {
    return {
      id: this.id,
      name: this.name,
      properties: [...this.properties],
      relations: [...this.relations],
      created_at: this.createdAt,
    };
  }
}
