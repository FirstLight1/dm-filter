import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config.js
vi.mock('../config.js', () => ({
  ANTHROPIC_API_KEY: 'test-api-key',
}));

// Mock the Anthropic SDK
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    constructor() {
      this.messages = { create: mockCreate };
    }
  },
}));

describe('classifier.js', () => {
  let classifyMessage;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../classifier.js');
    classifyMessage = mod.classifyMessage;
  });

  it('should call Claude with correct model, max_tokens, and prompt caching', async () => {
    const classificationResult = {
      category: 'GYM',
      action: 'notify',
      reply_message: null,
      notify_title: 'Gym content from sender1',
      notify_body: 'Workout reel',
      confidence: 'high',
      reason: 'Shows gym equipment',
    };

    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(classificationResult) }],
    });

    await classifyMessage({
      senderId: 'sender1',
      messageText: 'check this workout',
      caption: 'Leg day',
      thumbnailBase64: null,
      mediaType: null,
      isReel: true,
    });

    expect(mockCreate).toHaveBeenCalledOnce();
    const callArgs = mockCreate.mock.calls[0][0];

    expect(callArgs.model).toBe('claude-haiku-4-5-20251001');
    expect(callArgs.max_tokens).toBe(500);

    // System prompt should have cache_control
    expect(callArgs.system).toEqual([
      expect.objectContaining({
        type: 'text',
        cache_control: { type: 'ephemeral' },
      }),
    ]);
    expect(callArgs.system[0].text).toContain('Instagram DM and Reel content classifier');
  });

  it('should include image block when thumbnail is provided', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"category":"GYM","action":"notify","reply_message":null,"notify_title":"t","notify_body":"b","confidence":"high","reason":"r"}' }],
    });

    await classifyMessage({
      senderId: 's1',
      messageText: 'look',
      caption: '',
      thumbnailBase64: 'abc123base64data',
      mediaType: 'image/jpeg',
      isReel: true,
    });

    const callArgs = mockCreate.mock.calls[0][0];
    const userContent = callArgs.messages[0].content;

    expect(userContent).toHaveLength(2);
    expect(userContent[0].type).toBe('text');
    expect(userContent[1]).toEqual({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: 'abc123base64data',
      },
    });
  });

  it('should NOT include image block when thumbnail is null', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"category":"OTHER","action":"notify","reply_message":null,"notify_title":"t","notify_body":"b","confidence":"high","reason":"r"}' }],
    });

    await classifyMessage({
      senderId: 's1',
      messageText: 'hello',
      caption: '',
      thumbnailBase64: null,
      mediaType: null,
      isReel: false,
    });

    const userContent = mockCreate.mock.calls[0][0].messages[0].content;
    expect(userContent).toHaveLength(1);
    expect(userContent[0].type).toBe('text');
  });

  it('should build correct JSON input in user message', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"category":"OTHER","action":"notify","reply_message":null,"notify_title":"t","notify_body":"b","confidence":"low","reason":"r"}' }],
    });

    await classifyMessage({
      senderId: 'user-42',
      messageText: 'hey there',
      caption: 'My caption',
      thumbnailBase64: null,
      mediaType: null,
      isReel: false,
    });

    const textContent = mockCreate.mock.calls[0][0].messages[0].content[0].text;
    const parsed = JSON.parse(textContent);

    expect(parsed.sender_id).toBe('user-42');
    expect(parsed.message_text).toBe('hey there');
    expect(parsed.caption).toBe('My caption');
    expect(parsed.is_reel).toBe(false);
  });

  it('should parse JSON response correctly', async () => {
    const expected = {
      category: 'POKEMON',
      action: 'auto_reply',
      reply_message: 'cool',
      notify_title: null,
      notify_body: null,
      confidence: 'high',
      reason: 'Pokemon card shown',
    };

    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(expected) }],
    });

    const result = await classifyMessage({
      senderId: 's',
      messageText: 't',
      caption: '',
      thumbnailBase64: null,
      mediaType: null,
      isReel: false,
    });

    expect(result).toEqual(expected);
  });

  it('should strip markdown backticks from response', async () => {
    const expected = { category: 'GYM', action: 'notify', reply_message: null, notify_title: 'T', notify_body: 'B', confidence: 'high', reason: 'R' };

    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '```json\n' + JSON.stringify(expected) + '\n```' }],
    });

    const result = await classifyMessage({
      senderId: 's',
      messageText: 't',
      caption: '',
      thumbnailBase64: null,
      mediaType: null,
      isReel: false,
    });

    expect(result.category).toBe('GYM');
  });

  it('should return error fallback when Claude call fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockCreate.mockRejectedValueOnce(new Error('API key invalid'));

    const result = await classifyMessage({
      senderId: 'user-99',
      messageText: 'test',
      caption: '',
      thumbnailBase64: null,
      mediaType: null,
      isReel: false,
    });

    expect(result.category).toBe('OTHER');
    expect(result.action).toBe('notify');
    expect(result.notify_title).toBe('Classification error');
    expect(result.notify_body).toContain('user-99');
    expect(result.confidence).toBe('low');
    consoleSpy.mockRestore();
  });

  it('should return error fallback when response has no text block', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'image', source: {} }],
    });

    const result = await classifyMessage({
      senderId: 'user-1',
      messageText: 'test',
      caption: '',
      thumbnailBase64: null,
      mediaType: null,
      isReel: false,
    });

    expect(result.category).toBe('OTHER');
    expect(result.action).toBe('notify');
    consoleSpy.mockRestore();
  });

  it('should return error fallback when response is invalid JSON', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'not valid json at all' }],
    });

    const result = await classifyMessage({
      senderId: 'user-1',
      messageText: 'test',
      caption: '',
      thumbnailBase64: null,
      mediaType: null,
      isReel: false,
    });

    expect(result.category).toBe('OTHER');
    expect(result.action).toBe('notify');
    consoleSpy.mockRestore();
  });

  it('should handle empty messageText and caption gracefully', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"category":"OTHER","action":"notify","reply_message":null,"notify_title":"t","notify_body":"b","confidence":"low","reason":"r"}' }],
    });

    await classifyMessage({
      senderId: 's',
      messageText: undefined,
      caption: undefined,
      thumbnailBase64: null,
      mediaType: null,
      isReel: false,
    });

    const textContent = mockCreate.mock.calls[0][0].messages[0].content[0].text;
    const parsed = JSON.parse(textContent);
    expect(parsed.message_text).toBe('');
    expect(parsed.caption).toBe('');
  });
});
