/**
 * Whether the address is the sprite sheet page: `/_sprites` at the end of the path (the dev server
 * and any host that serves the app for unknown paths), or `#/_sprites` (GitHub Pages, which 404s
 * unknown paths, so the PR previews need the hash form).
 */
export function isSpritesRoute(pathname: string, hash: string): boolean {
  return pathname.replace(/\/+$/, '').endsWith('/_sprites') || hash.replace(/\/+$/, '') === '#/_sprites';
}
