/**
 * @fileoverview Records outbound HTTP calls and answers them with a handler.
 */

/** A recorded call. */
export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** A fetch replacement for adapters that accept an injected fetch. */
export class FetchMock {
  readonly calls: RecordedCall[] = [];

  constructor(
    private handler: (
      call: RecordedCall,
    ) => Response | Promise<Response> = () =>
      new Response('{}', {
        status: 200,
        headers: {'content-type': 'application/json'},
      }),
  ) {}

  /** Replaces the response handler. */
  respond(handler: (call: RecordedCall) => Response | Promise<Response>): void {
    this.handler = handler;
  }

  readonly fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const req =
      input instanceof Request ? input : new Request(String(input), init);
    const call: RecordedCall = {
      url: req.url,
      method: req.method,
      headers: Object.fromEntries(req.headers),
      body: req.body ? await req.text() : '',
    };
    this.calls.push(call);
    return this.handler(call);
  };
}
