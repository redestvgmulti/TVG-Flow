const RESERVED = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'direct', 'accounts', 'about', 'developer', 'legal', 'privacy', 'web', 'api']);

/** Shared by the future source form, configuration endpoint and providers. */
export function normalizeInstagramProfile(input) {
  if (typeof input !== 'string') throw new Error('INSTAGRAM_SOURCE_INVALID');
  let username = input.trim();
  if (/^https?:\/\//i.test(username)) {
    let url;
    try { url = new URL(username); } catch { throw new Error('INSTAGRAM_SOURCE_INVALID'); }
    if (!['instagram.com', 'www.instagram.com'].includes(url.hostname.toLowerCase()) ||
        url.username || url.password || url.port) throw new Error('INSTAGRAM_SOURCE_INVALID');
    const match = url.pathname.match(/^\/([A-Za-z0-9._]+)\/?$/);
    if (!match) throw new Error('INSTAGRAM_SOURCE_INVALID');
    username = match[1];
  } else {
    username = username.replace(/^@/, '');
  }
  username = username.toLowerCase();
  if (!/^[a-z0-9_](?:[a-z0-9._]{0,28}[a-z0-9_])?$/.test(username) ||
      username.includes('..') || RESERVED.has(username)) throw new Error('INSTAGRAM_SOURCE_INVALID');
  return { username, url: `https://www.instagram.com/${username}/` };
}

export function normalizeInstagramPermalink(input) {
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !['instagram.com', 'www.instagram.com'].includes(url.hostname.toLowerCase())) return null;
    const match = url.pathname.match(/^\/(p|reel|tv)\/([A-Za-z0-9_-]+)\/?$/);
    return match ? `https://www.instagram.com/${match[1]}/${match[2]}/` : null;
  } catch { return null; }
}
