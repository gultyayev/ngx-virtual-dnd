// Compile-time flags Rspress defines for theme and MDX component code.
interface ImportMetaEnv {
  /** True while Rspress renders pages to Markdown (llms.txt, "Copy Markdown"). */
  readonly SSG_MD?: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
