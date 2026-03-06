import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config.js
vi.mock('../config.js', () => ({
  INSTAGRAM_PAGE_ACCESS_TOKEN: 'test-access-token',
}));

// Mock node-fetch
const mockFetch = vi.fn();
vi.mock('node-fetch', () => ({ default: mockFetch }));

describe('instagram.js', () => {
  let sendReply, getReelInfo, sendReaction, fetchThumbnailAsBase64;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../instagram.js');
    sendReply = mod.sendReply;
    getReelInfo = mod.getReelInfo;
    sendReaction = mod.sendReaction;
    fetchThumbnailAsBase64 = mod.fetchThumbnailAsBase64;
  });

  describe('sendReply', () => {
    it('should POST a message to the Graph API', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await sendReply('recipient-123', 'Hello!');

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];

      expect(url).toContain('https://graph.facebook.com/v19.0/me/messages');
      expect(url).toContain('access_token=test-access-token');
      expect(opts.method).toBe('POST');
      expect(opts.headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(opts.body);
      expect(body.recipient.id).toBe('recipient-123');
      expect(body.message.text).toBe('Hello!');
    });

    it('should log error on non-ok response', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad Request',
      });

      await sendReply('r-123', 'test');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('sendReply failed')
      );
      consoleSpy.mockRestore();
    });
  });

  describe('getReelInfo', () => {
    it('should GET reel info with correct fields', async () => {
      const reelData = {
        caption: 'Test caption',
        media_url: 'https://example.com/media.mp4',
        thumbnail_url: 'https://example.com/thumb.jpg',
        media_type: 'VIDEO',
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => reelData,
      });

      const result = await getReelInfo('media-456');

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('/media-456?');
      expect(url).toContain('fields=caption,media_url,thumbnail_url,media_type');
      expect(url).toContain('access_token=test-access-token');
      expect(result).toEqual(reelData);
    });

    it('should return empty object on API error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'Not Found',
      });

      const result = await getReelInfo('bad-id');

      expect(result).toEqual({});
      consoleSpy.mockRestore();
    });

    it('should return empty object on network error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await getReelInfo('media-789');

      expect(result).toEqual({});
      consoleSpy.mockRestore();
    });
  });

  describe('sendReaction', () => {
    it('should POST a love reaction', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await sendReaction('recipient-123', 'msg-456');

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];

      expect(url).toContain('/me/messages');
      const body = JSON.parse(opts.body);
      expect(body.recipient.id).toBe('recipient-123');
      expect(body.sender_action).toBe('react');
      expect(body.payload.message_id).toBe('msg-456');
      expect(body.payload.reaction).toBe('love');
    });

    it('should log error on non-ok response', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => 'Forbidden',
      });

      await sendReaction('r', 'm');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('fetchThumbnailAsBase64', () => {
    it('should fetch image and return base64 + mediaType', async () => {
      const fakeBuffer = Buffer.from('fake-image-data');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: (h) => h === 'content-type' ? 'image/jpeg' : null },
        buffer: async () => fakeBuffer,
      });

      const result = await fetchThumbnailAsBase64('https://example.com/thumb.jpg');

      expect(result).toEqual({
        base64: fakeBuffer.toString('base64'),
        mediaType: 'image/jpeg',
      });
    });

    it('should default mediaType to image/jpeg when header missing', async () => {
      const fakeBuffer = Buffer.from('data');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => null },
        buffer: async () => fakeBuffer,
      });

      const result = await fetchThumbnailAsBase64('https://example.com/img');

      expect(result.mediaType).toBe('image/jpeg');
    });

    it('should return null on non-ok response (fail silently)', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });

      const result = await fetchThumbnailAsBase64('https://example.com/forbidden');

      expect(result).toBeNull();
      consoleSpy.mockRestore();
    });

    it('should return null on network error (fail silently)', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockFetch.mockRejectedValueOnce(new Error('Timeout'));

      const result = await fetchThumbnailAsBase64('https://example.com/slow');

      expect(result).toBeNull();
      consoleSpy.mockRestore();
    });
  });
});
