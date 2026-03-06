import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dotenv so it doesn't try to read .env files
vi.mock('dotenv/config', () => ({}));

describe('config.js', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('should export env vars from process.env', async () => {
    process.env.INSTAGRAM_PAGE_ACCESS_TOKEN = 'test-token';
    process.env.INSTAGRAM_APP_SECRET = 'test-secret';
    process.env.WEBHOOK_VERIFY_TOKEN = 'test-verify';
    process.env.ANTHROPIC_API_KEY = 'test-anthropic';
    process.env.NTFY_TOPIC = 'test-topic';
    process.env.WHITELISTED_SENDER_IDS = '111,222,333';

    const config = await import('../config.js');

    expect(config.INSTAGRAM_PAGE_ACCESS_TOKEN).toBe('test-token');
    expect(config.INSTAGRAM_APP_SECRET).toBe('test-secret');
    expect(config.WEBHOOK_VERIFY_TOKEN).toBe('test-verify');
    expect(config.ANTHROPIC_API_KEY).toBe('test-anthropic');
    expect(config.NTFY_TOPIC).toBe('test-topic');
  });

  it('should parse WHITELISTED_SENDER_IDS into a Set and isWhitelisted works', async () => {
    process.env.WHITELISTED_SENDER_IDS = '111, 222 , 333';

    const { isWhitelisted } = await import('../config.js');

    expect(isWhitelisted('111')).toBe(true);
    expect(isWhitelisted('222')).toBe(true);
    expect(isWhitelisted('333')).toBe(true);
    expect(isWhitelisted('999')).toBe(false);
  });

  it('should handle empty WHITELISTED_SENDER_IDS', async () => {
    process.env.WHITELISTED_SENDER_IDS = '';

    const { isWhitelisted } = await import('../config.js');

    expect(isWhitelisted('111')).toBe(false);
    expect(isWhitelisted('')).toBe(false);
  });

  it('should handle undefined WHITELISTED_SENDER_IDS', async () => {
    delete process.env.WHITELISTED_SENDER_IDS;

    const { isWhitelisted } = await import('../config.js');

    expect(isWhitelisted('111')).toBe(false);
  });

  it('should coerce numeric senderId to string for lookup', async () => {
    process.env.WHITELISTED_SENDER_IDS = '17841400000000000';

    const { isWhitelisted } = await import('../config.js');

    expect(isWhitelisted(17841400000000000)).toBe(true);
    expect(isWhitelisted('17841400000000000')).toBe(true);
  });

  it('should filter out empty entries from comma-separated IDs', async () => {
    process.env.WHITELISTED_SENDER_IDS = '111,,222,,,333,';

    const { isWhitelisted } = await import('../config.js');

    expect(isWhitelisted('111')).toBe(true);
    expect(isWhitelisted('222')).toBe(true);
    expect(isWhitelisted('333')).toBe(true);
    expect(isWhitelisted('')).toBe(false);
  });
});
