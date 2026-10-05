/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The Worker API. Empty means offline-only, which is a valid ship state. */
  readonly VITE_API_BASE?: string;
  /** The URL a shared score points at. */
  readonly VITE_SHARE_URL?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }

/** Tally, the first-party visit counter (hi.gachichio.org). Absent when blocked or opted out, so always call it with ?. */
interface Window {
  tally?: { page: (path: string) => void; click: (label: string) => void };
}
