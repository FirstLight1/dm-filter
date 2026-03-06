import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config.js
vi.mock('../config.js', () => ({
  NTFY_TOPIC: 'test-topic',
}));

// Mock node-fetch
const mockFetch = vi.fn();
vi.mock('node-fetch', () => ({ default: mockFetch }));

describe('notify.js', () => {
  let sendNotification;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../notify.js');
    sendNotification = mod.sendNotification;
  });

  it('should POST to ntfy.sh with correct URL, headers, and body', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    await sendNotification({
      title: 'Test Title',
      body: 'Test body message',
      priority: 'high',
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];

    expect(url).toBe('https://ntfy.sh/test-topic');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Title).toBe('Test Title');
    expect(opts.headers.Priority).toBe('high');
    expect(opts.headers['Content-Type']).toBe('text/plain');
    expect(opts.body).toBe('Test body message');
  });

  it('should default priority to "default"', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    await sendNotification({
      title: 'Title',
      body: 'Body',
    });

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers.Priority).toBe('default');
  });

  it('should log error on non-ok response but not throw', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    await sendNotification({ title: 'T', body: 'B' });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('500')
    );
    consoleSpy.mockRestore();
  });

  it('should catch fetch errors and not throw', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));

    await sendNotification({ title: 'T', body: 'B' });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[notify]'),
      'Network failure'
    );
    consoleSpy.mockRestore();
  });
});
