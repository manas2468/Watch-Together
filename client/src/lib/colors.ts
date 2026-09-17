/**
 * Deterministic HSL color from username hash.
 * Matches the server's RoomManager.usernameToColor() exactly.
 */
export function usernameToColor(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
    hash = hash & hash;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

/**
 * Generate initials from a username (first 1-2 chars, uppercased).
 */
export function getInitials(username: string): string {
  return username.slice(0, 2).toUpperCase();
}
