import { streamSource } from './discovery.js';

export function validateStreamSettings(input = {}) {
  const result = {};
  for (const key of ['streamer_name', 'game_name', 'stream_url', 'thumbnail_url']) {
    if (input[key] == null || input[key] === '') continue;
    if (typeof input[key] !== 'string' || input[key].length > (key.endsWith('url') ? 2048 : 100)) throw new Error(`Invalid ${key.replaceAll('_', ' ')}`);
    if (input[key].trim()) result[key] = input[key].trim();
  }
  if (result.stream_url && !streamSource(result.stream_url)) throw new Error('Use an HTTPS Twitch channel or YouTube video URL.');
  if (result.thumbnail_url) {
    try { if (new URL(result.thumbnail_url).protocol !== 'https:') throw new Error(); }
    catch { throw new Error('Thumbnail must be an HTTPS image URL.'); }
  }
  if (input.viewer_count != null && input.viewer_count !== '') {
    if (!Number.isSafeInteger(input.viewer_count) || input.viewer_count < 0 || input.viewer_count > 2147483647) throw new Error('Viewer snapshot must be a nonnegative whole number.');
    result.viewer_count = input.viewer_count;
  }
  return result;
}
