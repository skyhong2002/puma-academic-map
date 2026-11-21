export async function commentBoardId({ section, raw }) {
  const input = new TextEncoder().encode(JSON.stringify([section, raw]));
  const digest = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(digest).subarray(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
