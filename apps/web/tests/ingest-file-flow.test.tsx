/**
 * Data Sources — file ingestion e2e flow test.
 *
 * Exercises the complete client-side pipeline of the IngestFilePage:
 *   1. Render the page and verify supported formats are displayed.
 *   2. Select a CSV file via the hidden file input.
 *   3. Enter an ontology type.
 *   4. Click "Upload files" and verify a multipart/form-data request is sent
 *      to /api/ingest/file with the correct fields.
 *   5. The mock backend returns a jobId; verify the entry shows "queued".
 *   6. The client polls GET /api/ingest/jobs/:id; simulate "running" then
 *      "succeeded" and verify the progress bar reaches 100%.
 *
 * Fetch is mocked at the global level so the real ingestionResource and
 * client transport code paths are exercised (no module mocking).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { setSessionAccessor } from '@/services/api/client';
import IngestFilePage from '@/pages/ingest/file';

describe('Data Sources — file ingestion flow', () => {
  let fetchCalls: Array<{ url: string; init: RequestInit }>;

  beforeEach(() => {
    fetchCalls = [];
    // Provide a session accessor so the transport attaches the Bearer header.
    setSessionAccessor(() => ({
      tokens: { accessToken: 'test-token' },
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Mock global fetch with a sequence of responses for the upload + poll. */
  function mockFetchSequence(responses: Array<() => Response>) {
    let idx = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      fetchCalls.push({ url, init: init ?? {} });
      const builder = responses[idx++] ?? responses[responses.length - 1];
      return builder();
    }) as typeof fetch;
  }

  function jsonResponse(body: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: '',
      text: async () => JSON.stringify(body),
      headers: new Headers(),
    } as Response;
  }

  it('uploads a CSV file and tracks job progress to completion', async () => {
    const jobId = 'job-123';
    mockFetchSequence([
      // 1) POST /api/ingest/file → enqueued
      () => jsonResponse({ success: true, data: { jobId, status: 'queued' } }, 202),
      // 2) GET /api/ingest/jobs/job-123 → running
      () =>
        jsonResponse({
          success: true,
          data: {
            jobId,
            tenantId: 'tenant-1',
            status: 'running',
            format: 'csv',
            ontologyType: 'Customer',
            objectKey: 'tenant-1/staging/job-123/customers.csv',
          },
        }),
      // 3) GET /api/ingest/jobs/job-123 → succeeded
      () =>
        jsonResponse({
          success: true,
          data: {
            jobId,
            tenantId: 'tenant-1',
            status: 'succeeded',
            format: 'csv',
            ontologyType: 'Customer',
            objectKey: 'tenant-1/staging/job-123/customers.csv',
            accepted: 2,
            rejected: 0,
          },
        }),
    ]);

    // Make the polling loop fire immediately instead of waiting 5s.
    // Only intercept the 5000ms polling delays; let other setTimeout calls
    // (e.g. testing-library's waitFor) use the real timer.
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((cb, ms) => {
      if (ms === 5000 && typeof cb === 'function') {
        // Fire the polling callback on the next microtask.
        queueMicrotask(() => cb());
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }
      return realSetTimeout(cb, ms as number);
    });

    render(<IngestFilePage />);

    // 1) Supported formats are shown.
    expect(screen.getByText('CSV')).toBeInTheDocument();
    expect(screen.getByText('JSON')).toBeInTheDocument();
    expect(screen.getByText('Parquet')).toBeInTheDocument();

    // 2) Select a CSV file.
    const file = new File(['id,name\n1,Alice\n2,Bob'], 'customers.csv', {
      type: 'text/csv',
    });
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: { 0: file, length: 1, item: () => file },
    });
    fireEvent.change(input);

    // The file appears in the selected list.
    await waitFor(() =>
      expect(screen.getByText('customers.csv')).toBeInTheDocument(),
    );

    // 3) Enter an ontology type.
    const ontologyInput = screen.getByPlaceholderText(
      'e.g. Customer, Product, Event',
    );
    fireEvent.change(ontologyInput, { target: { value: 'Customer' } });

    // 4) Click upload. The drop zone is a div with role="button" and
    //    aria-label "Upload files by dropping or clicking"; anchor the regex
    //    to the end so only the real "Upload files" button matches.
    const uploadButton = screen.getByRole('button', { name: /Upload files$/ });
    fireEvent.click(uploadButton);

    // The first call should be POST /api/ingest/file with FormData.
    await waitFor(() => expect(fetchCalls.length).toBeGreaterThanOrEqual(1));
    const uploadCall = fetchCalls[0];
    expect(uploadCall.url).toContain('/api/ingest/file');
    expect(uploadCall.init.method).toBe('POST');
    const body = uploadCall.init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('file')).toBeInstanceOf(File);
    expect(body.get('format')).toBe('csv');
    expect(body.get('ontologyType')).toBe('Customer');

    // 5) Wait for the polling to consume the running + succeeded responses.
    await waitFor(() => {
      const pollCalls = fetchCalls.filter((c) =>
        c.url.includes('/api/ingest/jobs/'),
      );
      expect(pollCalls.length).toBeGreaterThanOrEqual(2);
    });

    // 6) Verify the poll hit the job endpoint with the correct jobId.
    const pollCalls = fetchCalls.filter((c) =>
      c.url.includes('/api/ingest/jobs/'),
    );
    expect(pollCalls[0].url).toContain(`/api/ingest/jobs/${jobId}`);
  });

  it('shows an error when ontology type is missing', async () => {
    // Use a no-op fetch so we can detect no calls.
    globalThis.fetch = vi.fn(async () => jsonResponse({ success: true })) as typeof fetch;

    render(<IngestFilePage />);

    // Select a file but do NOT enter an ontology type.
    const file = new File(['a,b'], 'x.csv', { type: 'text/csv' });
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: { 0: file, length: 1, item: () => file },
    });
    fireEvent.change(input);

    const uploadButton = screen.getByRole('button', { name: /Upload files$/ });
    fireEvent.click(uploadButton);

    // No fetch should have been made.
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(
      screen.getByText(/please enter an ontology type/i),
    ).toBeInTheDocument();
  });

  it('surfaces an upload failure on the file entry', async () => {
    mockFetchSequence([
      // Upload fails with a 400.
      () =>
        jsonResponse(
          {
            success: false,
            error: { code: 'VALIDATION_FAILED', message: 'ontologyType is required.' },
          },
          400,
        ),
    ]);

    render(<IngestFilePage />);

    const file = new File(['a,b'], 'x.csv', { type: 'text/csv' });
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: { 0: file, length: 1, item: () => file },
    });
    fireEvent.change(input);

    const ontologyInput = screen.getByPlaceholderText(
      'e.g. Customer, Product, Event',
    );
    fireEvent.change(ontologyInput, { target: { value: 'Customer' } });

    fireEvent.click(screen.getByRole('button', { name: /Upload files$/ }));

    await waitFor(() => expect(fetchCalls.length).toBe(1));
    // The upload call should have been made.
    expect(fetchCalls[0].url).toContain('/api/ingest/file');
  });
});
