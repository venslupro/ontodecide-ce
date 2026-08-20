/**
 * Tenant value object (DDD domain layer).
 *
 * Encapsulates the format and equality rules for the tenant identifier that
 * flows through the entire request pipeline (see design doc §5.2).
 */
export class TenantId {
  private constructor(public readonly value: string) {}

  /**
   * Construct a TenantId from a raw string.
   * @throws {Error} when the value does not match `tenant_xxxx`.
   */
  public static from(raw: string): TenantId {
    if (!/^tenant_[a-zA-Z0-9_-]{4,32}$/.test(raw)) {
      throw new Error(`Invalid tenant id: ${raw}`);
    }
    return new TenantId(raw);
  }

  /** Anonymous tenant sentinel used for public (pre-auth) routes. */
  public static ANONYMOUS = new TenantId('tenant_anon');

  public equals(other: TenantId): boolean {
    return this.value === other.value;
  }

  public toString(): string {
    return this.value;
  }
}
