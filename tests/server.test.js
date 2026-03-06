import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

// --- Mocks ---

vi.mock('dotenv/config', () => ({}));

const APP_SECRET = 'test-app-secret';
const VERIFY_TOKEN = 'test-verify-token';
let mockWhitelist = new Set(['111', '222']);

vi.mock('../config.js', () => ({
  INSTAGRAM_APP_SECRET: APP_SECRET,
  WEBHOOK_VERIFY_TOKEN: VERIFY_TOKEN,
  INSTAGRAM_PAGE_ACCESS_TOKEN: 'test-token',
  ANTHROPIC_API_KEY: 'test-key',
  NTFY_TOPIC: 'test-topic',
  isWhitelisted: (id) => mockWhitelist.has(String(id)),
}));

const mockSendNotification = vi.fn().mockResolvedValue(undefined);
vi.mock('../notify.js', () => ({
  sendNotification: (...args) => mockSendNotification(...args),
}));

const mockSendReply = vi.fn().mockResolvedValue(undefined);
const mockGetReelInfo = vi.fn().mockResolvedValue({});
const mockSendReaction = vi.fn().mockResolvedValue(undefined);
const mockFetchThumbnail = vi.fn().mockResolvedValue(null);
vi.mock('../instagram.js', () => ({
  sendReply: (...args) => mockSendReply(...args),
  getReelInfo: (...args) => mockGetReelInfo(...args),
  sendReaction: (...args) => mockSendReaction(...args),
  fetchThumbnailAsBase64: (...args) => mockFetchThumbnail(...args),
}));

const mockClassifyMessage = vi.fn();
vi.mock('../classifier.js', () => ({
  classifyMessage: (...args) => mockClassifyMessage(...args),
}));

// --- Helpers ---

function sign(body) {
  return 'sha256=' + crypto
    .createHmac('sha256', APP_SECRET)
    .update(Buffer.from(body))
    .digest('hex');
}

function makeWebhookBody(senderId, text, attachment = null) {
  const message = { mid: 'msg-id-123', text };
  if (attachment) {
    message.attachments = [attachment];
  }
  return JSON.stringify({
    object: 'instagram',
    entry: [{
      id: '0',
      time: Date.now(),
      changes: [{
        field: 'messages',
        value: {
          sender: { id: senderId },
          recipient: { id: 'page-id' },
          timestamp: String(Date.now()),
          message,
        },
      }],
    }],
  });
}

// Use a raw HTTP approach since express.raw() needs actual Buffer bodies
// We import the app and use Node's http to test it.
import http from 'http';

async function request(server, { method, path, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, `http://localhost:${server.address().port}`);
    const req = http.request(url, { method, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('server.js', () => {
  let app, server, handleWebhookEvent, processMessage, sendHatefulResponse, HATEFUL_REPLIES;

  beforeEach(async () => {
    vi.clearAllMocks();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const mod = await import('../server.js');
    app = mod.app;
    handleWebhookEvent = mod.handleWebhookEvent;
    processMessage = mod.processMessage;
    sendHatefulResponse = mod.sendHatefulResponse;
    HATEFUL_REPLIES = mod.HATEFUL_REPLIES;

    server = app.listen(0); // random port
  });

  afterEach(() => {
    server.close();
    vi.restoreAllMocks();
  });

  // --- GET /webhook (verification) ---

  describe('GET /webhook — verification', () => {
    it('should return challenge when mode and token are correct', async () => {
      const res = await request(server, {
        method: 'GET',
        path: `/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=test-challenge-123`,
      });

      expect(res.status).toBe(200);
      expect(res.body).toBe('test-challenge-123');
    });

    it('should return 403 when verify token is wrong', async () => {
      const res = await request(server, {
        method: 'GET',
        path: '/webhook?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=ch',
      });

      expect(res.status).toBe(403);
    });

    it('should return 403 when mode is not subscribe', async () => {
      const res = await request(server, {
        method: 'GET',
        path: `/webhook?hub.mode=unsubscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=ch`,
      });

      expect(res.status).toBe(403);
    });

    it('should return 403 when params are missing', async () => {
      const res = await request(server, {
        method: 'GET',
        path: '/webhook',
      });

      expect(res.status).toBe(403);
    });
  });

  // --- POST /webhook (HMAC signature) ---

  describe('POST /webhook — signature verification', () => {
    it('should return 200 with valid signature', async () => {
      const body = makeWebhookBody('111', 'hello');
      const sig = sign(body);

      mockClassifyMessage.mockResolvedValueOnce({
        category: 'OTHER',
        action: 'notify',
        notify_title: 'Message from 111',
        notify_body: 'hello',
        confidence: 'high',
        reason: 'test',
      });

      const res = await request(server, {
        method: 'POST',
        path: '/webhook',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': sig,
        },
        body,
      });

      expect(res.status).toBe(200);
    });

    it('should return 403 with invalid signature', async () => {
      const body = makeWebhookBody('111', 'hello');

      const res = await request(server, {
        method: 'POST',
        path: '/webhook',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': 'sha256=badbadbadbad',
        },
        body,
      });

      expect(res.status).toBe(403);
    });

    it('should return 403 when signature header is missing', async () => {
      const body = makeWebhookBody('111', 'hello');

      const res = await request(server, {
        method: 'POST',
        path: '/webhook',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      expect(res.status).toBe(403);
    });
  });

  // --- handleWebhookEvent ---

  describe('handleWebhookEvent', () => {
    it('should handle missing entry gracefully', async () => {
      await handleWebhookEvent({});
      expect(mockClassifyMessage).not.toHaveBeenCalled();
    });

    it('should handle missing changes and messaging data gracefully', async () => {
      await handleWebhookEvent({ entry: [{}] });
      expect(mockClassifyMessage).not.toHaveBeenCalled();
    });

    it('should handle missing sender ID gracefully', async () => {
      await handleWebhookEvent({
        entry: [{ changes: [{ field: 'messages', value: { message: { text: 'hi' } } }] }],
      });
      expect(mockClassifyMessage).not.toHaveBeenCalled();
    });

    it('should parse changes[] format correctly', async () => {
      mockClassifyMessage.mockResolvedValueOnce({
        category: 'OTHER', action: 'notify',
        notify_title: 'T', notify_body: 'B',
        confidence: 'high', reason: 'r',
      });

      await handleWebhookEvent({
        entry: [{
          changes: [{
            field: 'messages',
            value: {
              sender: { id: '111' },
              message: { mid: 'mid-1', text: 'hello' },
            },
          }],
        }],
      });

      expect(mockClassifyMessage).toHaveBeenCalledOnce();
    });

    it('should fall back to messaging[] format', async () => {
      mockClassifyMessage.mockResolvedValueOnce({
        category: 'OTHER', action: 'notify',
        notify_title: 'T', notify_body: 'B',
        confidence: 'high', reason: 'r',
      });

      await handleWebhookEvent({
        entry: [{
          messaging: [{
            sender: { id: '111' },
            message: { mid: 'mid-1', text: 'hello' },
          }],
        }],
      });

      expect(mockClassifyMessage).toHaveBeenCalledOnce();
    });
  });

  // --- processMessage ---

  describe('processMessage', () => {
    it('should notify for non-whitelisted sender', async () => {
      await processMessage('999', 'hello', null, 'msg-1');

      expect(mockSendNotification).toHaveBeenCalledWith({
        title: 'Unknown sender',
        body: expect.stringContaining('999'),
        priority: 'default',
      });
      expect(mockClassifyMessage).not.toHaveBeenCalled();
    });

    it('should classify and auto-reply for POKEMON', async () => {
      mockClassifyMessage.mockResolvedValueOnce({
        category: 'POKEMON',
        action: 'auto_reply',
        reply_message: 'cool',
        notify_title: null,
        notify_body: null,
        confidence: 'high',
        reason: 'Pokemon content',
      });

      await processMessage('111', 'check this pikachu', null, 'msg-1');

      expect(mockClassifyMessage).toHaveBeenCalledOnce();
      expect(mockSendReply).toHaveBeenCalledWith('111', 'cool');
    });

    it('should classify and notify for GYM', async () => {
      mockClassifyMessage.mockResolvedValueOnce({
        category: 'GYM',
        action: 'notify',
        reply_message: null,
        notify_title: 'Gym content from 111',
        notify_body: 'Workout reel',
        confidence: 'high',
        reason: 'Gym equipment visible',
      });

      await processMessage('111', 'new PR!', null, 'msg-1');

      expect(mockSendNotification).toHaveBeenCalledWith({
        title: 'Gym content from 111',
        body: 'Workout reel',
        priority: 'default',
      });
    });

    it('should classify and send hateful response for HATEFUL', async () => {
      mockClassifyMessage.mockResolvedValueOnce({
        category: 'HATEFUL',
        action: 'auto_reply',
        reply_message: 'ok',
        confidence: 'high',
        reason: 'Dog whistle detected',
      });

      // Deterministic: seed random to 0 => pick = reaction
      const mathSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5); // pick = 6

      await processMessage('111', 'hateful msg', null, 'msg-1');

      expect(mockSendReply).toHaveBeenCalledOnce();
      // pick=6 => HATEFUL_REPLIES[5] which is 'neuveriteľné veci'
      expect(mockSendReply.mock.calls[0][0]).toBe('111');

      mathSpy.mockRestore();
    });

    it('should fetch reel info and thumbnail when attachment present', async () => {
      mockGetReelInfo.mockResolvedValueOnce({
        caption: 'Reel caption',
        thumbnail_url: 'https://example.com/thumb.jpg',
      });
      mockFetchThumbnail.mockResolvedValueOnce({
        base64: 'dGVzdA==',
        mediaType: 'image/jpeg',
      });
      mockClassifyMessage.mockResolvedValueOnce({
        category: 'OTHER',
        action: 'notify',
        notify_title: 'Message from 111',
        notify_body: 'Reel',
        confidence: 'high',
        reason: 'unknown reel',
      });

      const attachment = { payload: { id: 'media-123' } };
      await processMessage('111', '', attachment, 'msg-1');

      expect(mockGetReelInfo).toHaveBeenCalledWith('media-123');
      expect(mockFetchThumbnail).toHaveBeenCalledWith('https://example.com/thumb.jpg');
      expect(mockClassifyMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          caption: 'Reel caption',
          thumbnailBase64: 'dGVzdA==',
          mediaType: 'image/jpeg',
          isReel: true,
        })
      );
    });

    it('should handle attachment without thumbnail gracefully', async () => {
      mockGetReelInfo.mockResolvedValueOnce({ caption: 'No thumb' });
      mockClassifyMessage.mockResolvedValueOnce({
        category: 'OTHER',
        action: 'notify',
        notify_title: 'T',
        notify_body: 'B',
        confidence: 'low',
        reason: 'r',
      });

      const attachment = { payload: { id: 'media-456' } };
      await processMessage('111', '', attachment, 'msg-1');

      expect(mockFetchThumbnail).not.toHaveBeenCalled();
      expect(mockClassifyMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          thumbnailBase64: null,
          mediaType: null,
          isReel: true,
        })
      );
    });

    it('should handle attachment without payload id', async () => {
      mockClassifyMessage.mockResolvedValueOnce({
        category: 'OTHER',
        action: 'notify',
        notify_title: 'T',
        notify_body: 'B',
        confidence: 'low',
        reason: 'r',
      });

      const attachment = { type: 'share' }; // no payload.id
      await processMessage('111', 'check this', attachment, 'msg-1');

      expect(mockGetReelInfo).not.toHaveBeenCalled();
      expect(mockClassifyMessage).toHaveBeenCalledWith(
        expect.objectContaining({ isReel: true, caption: '' })
      );
    });
  });

  // --- sendHatefulResponse ---

  describe('sendHatefulResponse', () => {
    it('should send reaction when random picks 0', async () => {
      const mathSpy = vi.spyOn(Math, 'random').mockReturnValue(0.0); // floor(0.0 * 13) = 0

      await sendHatefulResponse('r-1', 'msg-1');

      expect(mockSendReaction).toHaveBeenCalledWith('r-1', 'msg-1');
      expect(mockSendReply).not.toHaveBeenCalled();
      mathSpy.mockRestore();
    });

    it('should send text reply when random picks 1-12', async () => {
      const mathSpy = vi.spyOn(Math, 'random').mockReturnValue(0.08); // floor(0.08 * 13) = 1

      await sendHatefulResponse('r-1', 'msg-1');

      expect(mockSendReply).toHaveBeenCalledWith('r-1', HATEFUL_REPLIES[0]); // 'ok'
      expect(mockSendReaction).not.toHaveBeenCalled();
      mathSpy.mockRestore();
    });

    it('should send the last reply when random picks 12', async () => {
      const mathSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99); // floor(0.99 * 13) = 12

      await sendHatefulResponse('r-1', 'msg-1');

      expect(mockSendReply).toHaveBeenCalledWith('r-1', HATEFUL_REPLIES[11]); // 'jak povíš'
      mathSpy.mockRestore();
    });
  });

  // --- HATEFUL_REPLIES constant ---

  describe('HATEFUL_REPLIES', () => {
    it('should have exactly 12 text replies', () => {
      expect(HATEFUL_REPLIES).toHaveLength(12);
    });

    it('should contain the expected replies', () => {
      expect(HATEFUL_REPLIES).toContain('ok');
      expect(HATEFUL_REPLIES).toContain('noted');
      expect(HATEFUL_REPLIES).toContain('k');
      expect(HATEFUL_REPLIES).toContain('veľmi cool braček');
      expect(HATEFUL_REPLIES).toContain('fascinujúce');
      expect(HATEFUL_REPLIES).toContain('jak povíš');
      expect(HATEFUL_REPLIES).toContain('banger');
      expect(HATEFUL_REPLIES).toContain('sure buddy');
    });
  });
});
