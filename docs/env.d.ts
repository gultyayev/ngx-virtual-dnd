// Compile-time flags Rspress defines for theme and MDX component code.
interface ImportMetaEnv {
  /** True while Rspress renders pages to Markdown (llms.txt, "Copy Markdown"). */
  readonly SSG_MD?: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// react-dom ships no types in this repo (no @types/react-dom); the theme only needs createPortal
// (theme/components/NavHamburger.tsx portals the phone menu, as Rspress does).
declare module 'react-dom' {
  export function createPortal(
    children: import('react').ReactNode,
    container: Element | DocumentFragment,
  ): import('react').ReactPortal;
}
