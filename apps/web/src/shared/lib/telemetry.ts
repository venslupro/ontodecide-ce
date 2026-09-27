/**
 * @fileoverview Compatibility shim. CE has no frontend telemetry endpoint
 * and no third-party analytics (前端详细设计 6.5): `track` is a no-op and
 * errors are only logged locally (see error_report.ts). Kept so existing
 * call sites compile; new code should not call it.
 */

export {newErrorId, reportError} from './error_report';

/** No-op business event hook (nothing leaves the browser). */
export function track(_name: string, _objectType?: string): void {}
