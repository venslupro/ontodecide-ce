/**
 * @fileoverview Build version (`__APP_VERSION__`, injected by Vite
 * `define`), shown in the account menu "About" dialog and in error details
 * (前端详细设计 表 13 构建版本号).
 */

/** The SPA build version, e.g. `2.4.0`. */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
