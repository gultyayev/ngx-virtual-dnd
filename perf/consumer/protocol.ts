/** Test consumer instrumentation; none of this is part of the published library. */
export type Renderer = 'component' | 'directive';
export type Control =
  | 'none'
  | 'scan'
  | 'checks'
  | 'rows'
  | 'stall'
  | 'scroll-stall'
  | 'layout-thrash'
  | 'long-tasks';

export interface WorkCounters {
  hostChecks: number;
  rowChecks: number;
  keyReads: number;
  created: number;
  destroyed: number;
  live: number;
  peakLive: number;
}

export interface ContractConsumer {
  mount(options: {
    count: number;
    renderer: Renderer;
    dynamic: boolean;
    control?: Control;
  }): Promise<{ mountMs: number; counters: WorkCounters }>;
  reset(): void;
  snapshot(): WorkCounters;
  unmount(): Promise<void>;
}

declare global {
  interface Window {
    __vdndContract: ContractConsumer;
  }
}
