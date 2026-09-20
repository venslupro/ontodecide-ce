/**
 * Sync Connectors page — real API integration tests.
 *
 * Exercises the full client-side pipeline of IngestSyncPage:
 *   1. Renders with a loading state, then displays sources from GET /api/ingest/sources.
 *   2. Shows an empty-state message when no sources exist.
 *   3. Creates a new source via the add-source form (POST /api/ingest/sources).
 *   4. Deletes a source via the trash button (DELETE /api/ingest/sources/:id).
 *   5. Surfaces an error when the list endpoint fails.
 *
 * Fetch is mocked at the global level so the real ingestionResource and
 * client transport code paths are exercised (no module mocking).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { setSessionAccessor } from '@/services/api/client';
import IngestSyncPage from '@/pages/ingest/sync';

describe('Sync Connectors — real API flow', () => {
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

  const SAMPLE_SOURCE = {
    sourceId: 'src-001',
    tenantId: 'tenant-1',
    name: 'Product Events API',
    kind: 'json' as const,
    url: 'https://example.com/events',
    auth: 'bearer',
    status: 'healthy' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  it('loads and displays sources from the API', async () => {
    mockFetch([
      () => jsonResponse({ success: true, data: [SAMPLE_SOURCE] }),
    ]);

    render(<IngestSyncPage />);

    // Initially shows loading text.
    expect(screen.getByText(/Loading sources/i)).toBeInTheDocument();

    // After the fetch resolves, the source name appears.
    await waitFor(() =>
      expect(screen.getByText('Product Events API')).toBeInTheDocument(),
    );

    // The fetch call should target the sources endpoint.
    expect(fetchCalls[0].url).toContain('/api/ingest/sources');
  });

  it('shows an empty-state message when no sources exist', async () => {
    mockFetch([
      () => jsonResponse({ success: true, data: [] }),
    ]);

    render(<IngestSyncPage />);

    await waitFor(() =>
      expect(
        screen.getByText(/No sources connected yet/i),
      ).toBeInTheDocument(),
    );
  });

  it('creates a new source via the add-source form', async () => {
    const created = {
      ...SAMPLE_SOURCE,
      sourceId: 'src-002',
      name: 'New API',
    };

    // 1st call: GET /api/ingest/sources (initial load, empty)
    // 2nd call: POST /api/ingest/sources (create)
    mockFetch([
      () => jsonResponse({ success: true, data: [] }),
      () => jsonResponse({ success: true, data: created }, 201),
    ]);

    render(<IngestSyncPage />);

    // Wait for initial load to complete.
    await waitFor(() =>
      expect(
        screen.getByText(/No sources connected yet/i),
      ).toBeInTheDocument(),
    );

    // Fill in the add-source form.
    const nameInput = screen.getByPlaceholderText('e.g. Product Events API');
    fireEvent.change(nameInput, { target: { value: 'New API' } });

    const urlInput = screen.getByPlaceholderText(/https:\/\/…/);
    fireEvent.change(urlInput, { target: { value: 'https://example.com/new' } });

    // Click "Connect source".
    const connectButton = screen.getByRole('button', { name: /Connect source/i });
    fireEvent.click(connectButton);

    // Verify the POST request was made.
    await waitFor(() => {
      const postCalls = fetchCalls.filter(
        (c) => c.url.includes('/api/ingest/sources') && c.init.method === 'POST',
      );
      expect(postCalls.length).toBe(1);
    });

    // The new source should appear in the list.
    await waitFor(() =>
      expect(screen.getByText('New API')).toBeInTheDocument(),
    );
  });

  it('deletes a source when the trash button is clicked', async () => {
    // 1st: GET (list with one source)
    // 2nd: DELETE /api/ingest/sources/src-001
    mockFetch([
      () => jsonResponse({ success: true, data: [SAMPLE_SOURCE] }),
      () => jsonResponse({ success: true, data: { sourceId: 'src-001' } }),
    ]);

    render(<IngestSyncPage />);

    // Wait for the source to load.
    await waitFor(() =>
      expect(screen.getByText('Product Events API')).toBeInTheDocument(),
    );

    // Click the delete button.
    const deleteButton = screen.getByRole('button', { name: 'Delete' });
    fireEvent.click(deleteButton);

    // Verify a DELETE request was sent.
    await waitFor(() => {
      const deleteCalls = fetchCalls.filter(
        (c) => c.init.method === 'DELETE',
      );
      expect(deleteCalls.length).toBe(1);
      expect(deleteCalls[0].url).toContain('/api/ingest/sources/src-001');
    });

    // The source should be removed from the list.
    await waitFor(() =>
      expect(screen.queryByText('Product Events API')).not.toBeInTheDocument(),
    );
  });

  it('surfaces an error when the list endpoint fails', async () => {
    mockFetch([
      () => jsonResponse(
        { success: false, error: { code: 'AUTH_FORBIDDEN', message: 'Forbidden.' } },
        403,
      ),
    ]);

    render(<IngestSyncPage />);

    await waitFor(() =>
      expect(screen.getByText('Forbidden.')).toBeInTheDocument(),
    );
  });
});
