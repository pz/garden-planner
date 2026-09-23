/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set only in PR preview builds; see src/state/storageNamespace.ts. */
  readonly VITE_STORAGE_NAMESPACE?: string;
}
