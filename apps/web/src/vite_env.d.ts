/**
 * @fileoverview Ambient declarations: build-time constants and untyped
 * third-party modules.
 */

/// <reference types="vite/client" />

/** App version injected by Vite `define`. */
declare const __APP_VERSION__: string;

declare module 'cytoscape-fcose' {
  import type {Ext} from 'cytoscape';
  const fcose: Ext;
  export default fcose;
}

interface ImportMetaEnv {
  /** Cloudflare Turnstile site key (managed mode). */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}
