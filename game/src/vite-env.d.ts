/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The Worker API. Empty means offline-only, which is a valid ship state. */
  readonly VITE_API_BASE?: string;
  /** The URL a shared score points at. */
  readonly VITE_SHARE_URL?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }
