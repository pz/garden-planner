/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set only in PR preview builds; see src/app/state/storageNamespace.ts. */
  readonly VITE_STORAGE_NAMESPACE?: string;
}

/** Short git commit of the build; injected by `define` in vite.config.ts. */
declare const __APP_COMMIT__: string;
