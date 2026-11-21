/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_INVITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.jpg" {
  const src: string;
  export default src;
}
