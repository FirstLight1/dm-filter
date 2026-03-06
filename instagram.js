import fetch from 'node-fetch';
import { INSTAGRAM_PAGE_ACCESS_TOKEN } from './config.js';

const GRAPH_API = 'https://graph.facebook.com/v19.0';

/**
 * Send a text reply to an Instagram user.
 */
export async function sendReply(recipientId, messageText) {
  const res = await fetch(`${GRAPH_API}/me/messages?access_token=${INSTAGRAM_PAGE_ACCESS_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text: messageText },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[instagram] sendReply failed ${res.status}: ${text}`);
  }
}

/**
 * Fetch reel / media info from the Graph API.
 * Returns { caption, media_url, thumbnail_url, media_type } or empty object on failure.
 */
export async function getReelInfo(mediaId) {
  try {
    const fields = 'caption,media_url,thumbnail_url,media_type';
    const res = await fetch(
      `${GRAPH_API}/${mediaId}?fields=${fields}&access_token=${INSTAGRAM_PAGE_ACCESS_TOKEN}`
    );

    if (!res.ok) {
      console.error(`[instagram] getReelInfo failed ${res.status}: ${await res.text()}`);
      return {};
    }

    return await res.json();
  } catch (err) {
    console.error('[instagram] getReelInfo error:', err.message);
    return {};
  }
}

/**
 * Send a heart reaction to a specific message.
 */
export async function sendReaction(recipientId, messageId) {
  const res = await fetch(`${GRAPH_API}/me/messages?access_token=${INSTAGRAM_PAGE_ACCESS_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      sender_action: 'react',
      payload: {
        message_id: messageId,
        reaction: 'love',
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[instagram] sendReaction failed ${res.status}: ${text}`);
  }
}

/**
 * Fetch a thumbnail image and convert it to base64.
 * Returns { base64, mediaType } or null on failure (fail silently).
 */
export async function fetchThumbnailAsBase64(thumbnailUrl) {
  try {
    const res = await fetch(thumbnailUrl);
    if (!res.ok) {
      console.error(`[instagram] fetchThumbnail failed ${res.status}`);
      return null;
    }

    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const buffer = await res.buffer();
    const base64 = buffer.toString('base64');

    return { base64, mediaType: contentType };
  } catch (err) {
    console.error('[instagram] fetchThumbnail error:', err.message);
    return null;
  }
}
