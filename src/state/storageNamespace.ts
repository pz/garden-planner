/**
 * PR previews are served from the same origin as the live site (pz.github.io), so they share its
 * localStorage. Preview builds set `VITE_STORAGE_NAMESPACE` (e.g. "pr-15:") so every key they
 * read or write is prefixed and can never touch the gardens saved by the real app. Production
 * builds leave it unset, so their keys are unchanged.
 */
export function withNamespace(namespace: string | undefined, key: string): string {
  return namespace ? `${namespace}${key}` : key;
}

/** The localStorage key to use for `key` in this build. */
export function storageKey(key: string): string {
  return withNamespace(import.meta.env.VITE_STORAGE_NAMESPACE, key);
}
