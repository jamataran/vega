/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** Nombre de la academia que despliega Vega. Por defecto, "Vega". */
  readonly VITE_BRAND_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
