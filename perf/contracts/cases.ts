import type { Renderer } from '../consumer/protocol.ts';

export type ContractCase =
  | {
      kind: 'scaling' | 'placeholder' | 'no-reuse';
      renderer: Renderer;
      dynamic: boolean;
      title: string;
    }
  | { kind: 'controls'; title: string };

// Registration and report validation share the same inventory. Adding a matrix
// case cannot silently leave the report expecting a stale numeric test count.
export const CONTRACT_CASES: ContractCase[] = [];
for (const renderer of ['component', 'directive'] as const) {
  for (const dynamic of [false, true]) {
    const prefix = `${renderer}, ${dynamic ? 'dynamic' : 'fixed'} heights`;
    CONTRACT_CASES.push(
      {
        kind: 'scaling',
        renderer,
        dynamic,
        title: `${prefix}: work stays bounded from 1k to 100k`,
      },
      {
        kind: 'placeholder',
        renderer,
        dynamic,
        title: `${prefix}: placeholder movement leaves consumer rows clean`,
      },
      {
        kind: 'no-reuse',
        renderer,
        dynamic,
        title: `${prefix}: scrolling without pool reuse leaves the host clean`,
      },
    );
  }
}
CONTRACT_CASES.push({
  kind: 'controls',
  title: 'positive controls detect excess work, rendering and stalls',
});
