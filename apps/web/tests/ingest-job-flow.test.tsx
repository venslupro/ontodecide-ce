/**
 * Job detail page — real API integration tests.
 *
 * Exercises the full client-side pipeline of IngestJobPage:
 *   1. Renders with a loading state, then fetches and displays job details.
 *   2. Shows status badge, progress, and record counts from GET /api/ingest/jobs/:id.
 *   3. Polls for updates while job status is "running".
 *   4. Shows an error when the job is not found or fetch fails.
 *
 * Fetch is mocked at the global level so the real ingestionResource and
 * client transport code paths are exercised (no module mocking).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { setSessionAccessor } from '@/services/api/client';
import IngestJobPage from '@/pages/ingest/job';

/** Render the page inside a MemoryRouter so useParams() works. */
function renderJobPage(jobId: string) {
  return render(
    <MemoryRouter initialEntries={[`/ingest/jobs/${jobId}`]}>
      <Routes>
        <Route path="/ingest/jobs/:id" element={<IngestJobPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Job detail — real API flow', () => {
  let fetchCalls: Array<{ url: string; init: RequestInit }>;

  beforeEach(() => {
    fetchCalls = [];
    setSessionAccessor(() => ({
      tokens: { accessToken: 'test-token' },
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function jsonResponse(body: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: '',
      text: async () => JSON.stringify(body),
      headers: new Headers(),
    } as Response;
  }

  function mockFetch(responses: Array<() => Response>) {
    let idx = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      fetchCalls.push({ url, init: init ?? {} });
      const builder = responses[idx++] ?? responses[responses.length - 1];
      return builder();
    }) as typeof fetch;
  }

  it('loads and displays job details from the API', async () => {
    const jobId = 'job-abc';
    mockFetch([
      () =>
        jsonResponse({
          success: true,
          data: {
            jobId,
            tenantId: 'tenant-1',
            status: 'succeeded',
            format: 'csv',
            ontologyType: 'Customer',
            objectKey: 'tenant-1/staging/job-abc/data.csv',
            accepted: 42,
            rejected: 3,
            startedAt: '2026-01-01T10:00:00.000Z',
            finishedAt: '2026-01-01T10:01:30.000Z',
          },
        }),
    ]);

    renderJobPage(jobId);

    // Initially shows loading text.
    expect(screen.getByText(/Loading job details/i)).toBeInTheDocument();

    // After fetch resolves, job details appear.
    await waitFor(() =>
      expect(screen.getByText('Success')).toBeInTheDocument(),
    );

    // The job ID is shown.
    expect(screen.getByText(jobId)).toBeInTheDocument();

    // Record counts are displayed.
    await waitFor(() =>
      expect(screen.getByText('42')).toBeInTheDocument(),
    );

    // The first fetch should target the job endpoint.
    expect(fetchCalls[0].url).toContain(`/api/ingest/jobs/${jobId}`);
  });

  it('polls for updates while the job is running', async () => {
    const jobId = 'job-running';

    // Make the polling loop fire immediately instead of waiting 5s.
    // job.tsx uses setInterval(5000) for polling; intercept it so the
    // callback fires on the next microtask.
    vi.spyOn(globalThis, 'setInterval').mockImplementation((cb) => {
      if (typeof cb === 'function') {
        queueMicrotask(() => (cb as () => void)());
      }
      return 0 as unknown as ReturnType<typeof setInterval>;
    });

    mockFetch([
      // 1st: running
      () =>
        jsonResponse({
          success: true,
          data: {
            jobId,
            tenantId: 'tenant-1',
            status: 'running',
            format: 'json',
            ontologyType: 'Order',
            objectKey: 'tenant-1/staging/job-running/orders.json',
            accepted: 10,
            rejected: 0,
            startedAt: '2026-01-01T11:00:00.000Z',
          },
        }),
      // 2nd: succeeded (after poll)
      () =>
        jsonResponse({
          success: true,
          data: {
            jobId,
            tenantId: 'tenant-1',
            status: 'succeeded',
            format: 'json',
            ontologyType: 'Order',
            objectKey: 'tenant-1/staging/job-running/orders.json',
            accepted: 20,
            rejected: 0,
            startedAt: '2026-01-01T11:00:00.000Z',
            finishedAt: '2026-01-01T11:01:00.000Z',
          },
        }),
    ]);

    renderJobPage(jobId);

    // Initially shows "Running" status.
    await waitFor(() =>
      expect(screen.getByText('Running')).toBeInTheDocument(),
    );

    // After polling, status transitions to "Success".
    await waitFor(() =>
      expect(screen.getByText('Success')).toBeInTheDocument(),
    );

    // At least 2 fetches (initial + poll) to the job endpoint.
    const jobCalls = fetchCalls.filter((c) =>
      c.url.includes(`/api/ingest/jobs/${jobId}`),
    );
    expect(jobCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('shows an error when the job is not found', async () => {
    mockFetch([
      () =>
        jsonResponse(
          { success: false, error: { code: 'NOT_FOUND', message: 'Job not found.' } },
          404,
        ),
    ]);

    renderJobPage('job-missing');

    await waitFor(() =>
      expect(screen.getByText('Job not found.')).toBeInTheDocument(),
    );
  });

  it('displays the job error message for a failed job', async () => {
    mockFetch([
      () =>
        jsonResponse({
          success: true,
          data: {
            jobId: 'job-failed',
            tenantId: 'tenant-1',
            status: 'failed',
            format: 'parquet',
            ontologyType: 'Event',
            objectKey: 'tenant-1/staging/job-failed/events.parquet',
            accepted: 0,
            rejected: 5,
            error: 'Parquet decode error: unexpected end of stream.',
            startedAt: '2026-01-01T12:00:00.000Z',
            finishedAt: '2026-01-01T12:00:05.000Z',
          },
        }),
    ]);

    renderJobPage('job-failed');

    // Status badge shows "Failed".
    await waitFor(() =>
      expect(screen.getByText('Failed')).toBeInTheDocument(),
    );

    // The error detail is rendered in an alert.
    await waitFor(() =>
      expect(
        screen.getByText(/Parquet decode error/i),
      ).toBeInTheDocument(),
    );
  });
});
