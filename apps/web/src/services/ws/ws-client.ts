/**
 * Durable-Object WebSocket client (placeholder).
 *
 * <p>Wire the planning agent / live decision stream through here in a
 * follow-up task. The interface below is intentionally minimal: it
 * matches the durable shape used by the AI/agent service (a single Cloudflare
 * Workers Durable Object that upgrades fetch() to a WebSocket and routes
 * typed messages to the client).
 *
 * <p>Implementation is intentionally deferred so Task 2 can land with a
 * full typed HTTP surface first. Calling {@link open} (or any of the
 * instance methods) raises an error pointing at the future wiring work.
 */

/**
 * Typed message envelope sent or received via the live channel.
 *
 * @property type Stable message discriminator, e.g. "agent.tick" or
 *     "decision.draft".
 * @property payload Opaque, type-specific payload — callers should narrow
 *     via known {@code type} values.
 */
export interface WsMessage {
  readonly type: string;
  readonly payload?: unknown;
}

/**
 * Durable-Object WebSocket handle. Returned by {@link createWsClient} and
 * wrapped by the stub implementation that throws in this placeholder.
 */
export interface WsClient {
  /**
   * Opens the channel against a Durable Object endpoint. Blocks until the
   * server acknowledges the upgrade with the required protocol token.
   *
   * @param baseUrl Backend base origin (e.g. {@code https://api.example.com}).
   * @param path Durable-object route path (e.g. {@code /ws/agent/abc}).
   * @param token Short-lived bearer token minted by the Gateway.
   * @returns Resolves once the socket transitions to {@code OPEN}.
   */
  open(baseUrl: string, path: string, token: string): Promise<WsClient>;
  /**
   * Subscribes to messages whose {@code type} matches the discriminator.
   * Multiple handlers for the same type append; call {@link close} to
   * release all attached listeners in one shot.
   */
  on(type: string, handler: (msg: WsMessage) => void): () => void;
  /**
   * Sends a typed message upstream. Rejects when the socket is not open.
   */
  send(payload: WsMessage): Promise<void>;
  /**
   * Gracefully closes the socket and removes attached listeners. A {@code
   * close} event with the supplied code / reason is emitted.
   */
  close(code?: number, reason?: string): Promise<void>;
}

/**
 * Returns a stub {@link WsClient}. Every instance method throws the
 * canonical "Not implemented" error so future work on Durable Object
 * wiring is easy to locate via grep.
 *
 * @returns A non-functional placeholder {@link WsClient}.
 */
export function createWsClient(): WsClient {
  const notImpl = (): never => {
    throw new Error(
      'Not implemented: Durable Object WebSocket wiring is ' +
        'deferred to a future task.',
    );
  };
  return {
    open: () => Promise.reject(notImpl()),
    on: () => {
      notImpl();
      // unreachable
      return (): void => undefined;
    },
    send: () => Promise.reject(notImpl()),
    close: () => Promise.reject(notImpl()),
  };
}

/**
 * Opens a Durable Object WebSocket directly (compatibility helper matching
 * the top-level signature in the task brief). Returns a rejected promise
 * carrying the placeholder error — the real implementation will call
 * {@code new WebSocket(url, ['Sec-WebSocket-Protocol', token])} inside a
 * Durable-Object-enabled Cloudflare Worker context.
 *
 * @param baseUrl Origin of the backend / gateway.
 * @param path Absolute path routed to the Durable Object.
 * @param token Bearer token used for the Sec-WebSocket-Protocol upgrade.
 * @returns Never resolves; placeholder rejects with the TODO error.
 */
export async function open(
  baseUrl: string,
  path: string,
  token: string,
): Promise<WsClient> {
  void baseUrl;
  void path;
  void token;
  throw new Error(
    'Not implemented: Durable Object WebSocket wiring is ' +
      'deferred to a future task.',
  );
}
