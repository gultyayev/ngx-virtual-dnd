import { TestBed } from '@angular/core/testing';
import { NgZone } from '@angular/core';
import { DragSchedulerService } from './drag-scheduler.service';
import { CursorPosition } from '../models/drag-drop.models';

// Manual RAF mock — matches the pattern used in auto-scroll.service.spec.ts.
let rafCallbacks = new Map<number, FrameRequestCallback>();
let rafIdCounter = 0;

function mockRAF(cb: FrameRequestCallback): number {
  const id = ++rafIdCounter;
  rafCallbacks.set(id, cb);
  return id;
}

function mockCancelRAF(id: number): void {
  rafCallbacks.delete(id);
}

/** Fire all currently-queued RAF callbacks (callbacks may enqueue new ones). */
function flushRAF(): void {
  const batch = new Map(rafCallbacks);
  rafCallbacks.clear();
  for (const cb of batch.values()) {
    cb(performance.now());
  }
}

function pendingRAFCount(): number {
  return rafCallbacks.size;
}

describe('DragSchedulerService', () => {
  let service: DragSchedulerService;

  const originalRAF = globalThis.requestAnimationFrame;
  const originalCancelRAF = globalThis.cancelAnimationFrame;

  beforeEach(() => {
    rafCallbacks = new Map();
    rafIdCounter = 0;
    globalThis.requestAnimationFrame = mockRAF as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = mockCancelRAF;

    TestBed.configureTestingModule({});
    service = TestBed.inject(DragSchedulerService);
  });

  afterEach(() => {
    service.stop();
    globalThis.requestAnimationFrame = originalRAF;
    globalThis.cancelAnimationFrame = originalCancelRAF;
  });

  // ---------------------------------------------------------------------------
  // start()
  // ---------------------------------------------------------------------------
  describe('start()', () => {
    it('should schedule a RAF tick when started', () => {
      service.start(jest.fn());
      expect(pendingRAFCount()).toBe(1);
    });

    it('should not schedule multiple RAFs if called twice', () => {
      const onTick = jest.fn();
      service.start(onTick);
      service.start(onTick);
      expect(pendingRAFCount()).toBe(1);
    });

    it('should run the RAF loop outside Angular zone', () => {
      const ngZone = TestBed.inject(NgZone);
      const spy = jest.spyOn(ngZone, 'runOutsideAngular');
      service.start(jest.fn());
      expect(spy).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // stop()
  // ---------------------------------------------------------------------------
  describe('stop()', () => {
    it('should cancel the pending RAF', () => {
      service.start(jest.fn());
      expect(pendingRAFCount()).toBe(1);
      service.stop();
      expect(pendingRAFCount()).toBe(0);
    });

    it('should not call onTick after stop even if the RAF fires', () => {
      const onTick = jest.fn();
      service.start(onTick);
      // Race: the browser already queued the frame before cancelAnimationFrame ran.
      const [queuedFrame] = rafCallbacks.values();
      service.stop();

      queuedFrame(performance.now());

      expect(onTick).not.toHaveBeenCalled();
      expect(pendingRAFCount()).toBe(0);
    });

    it('should be safe to call when not running', () => {
      expect(() => service.stop()).not.toThrow();
    });

    it('should not reschedule when onTick stops the scheduler', () => {
      const onTick = jest.fn(() => service.stop());
      service.start(onTick);

      flushRAF();

      expect(onTick).toHaveBeenCalledTimes(1);
      expect(pendingRAFCount()).toBe(0);
    });

    it('should allow restarting after stop', () => {
      const onTick = jest.fn();
      service.start(onTick);
      service.stop();
      service.start(onTick);
      expect(pendingRAFCount()).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // tick behavior
  // ---------------------------------------------------------------------------
  describe('tick behavior', () => {
    it('should call onTick each frame and reschedule itself', () => {
      const onTick = jest.fn();
      service.start(onTick);

      flushRAF(); // frame 1
      expect(onTick).toHaveBeenCalledTimes(1);
      expect(pendingRAFCount()).toBe(1); // rescheduled for frame 2

      flushRAF(); // frame 2
      expect(onTick).toHaveBeenCalledTimes(2);
    });

    it('should call onTick with null cursor and cursorDirty=false when no cursor is queued', () => {
      const onTick = jest.fn();
      service.start(onTick);
      flushRAF();
      expect(onTick).toHaveBeenCalledWith(null, false);
    });

    it('should call onTick with the queued cursor and cursorDirty=true', () => {
      const onTick = jest.fn();
      const cursor: CursorPosition = { x: 100, y: 200 };
      service.start(onTick);
      service.queueCursorUpdate(cursor);
      flushRAF();
      expect(onTick).toHaveBeenCalledWith(cursor, true);
    });

    it('should reset cursorDirty to false on subsequent frames without a new cursor', () => {
      const onTick = jest.fn();
      const cursor: CursorPosition = { x: 100, y: 200 };
      service.start(onTick);
      service.queueCursorUpdate(cursor);

      flushRAF(); // frame 1: dirty
      flushRAF(); // frame 2: no new update

      expect(onTick).toHaveBeenNthCalledWith(1, cursor, true);
      expect(onTick).toHaveBeenNthCalledWith(2, cursor, false);
    });

    it('should use the latest cursor when multiple updates are queued before a frame', () => {
      const onTick = jest.fn();
      service.start(onTick);
      service.queueCursorUpdate({ x: 10, y: 20 });
      service.queueCursorUpdate({ x: 30, y: 40 });
      service.queueCursorUpdate({ x: 50, y: 60 });
      flushRAF();
      expect(onTick).toHaveBeenCalledWith({ x: 50, y: 60 }, true);
    });
  });

  // ---------------------------------------------------------------------------
  // participants
  // ---------------------------------------------------------------------------
  describe('participants', () => {
    it('should call registered participants before onTick in each frame', () => {
      const callOrder: string[] = [];
      const participant = jest.fn(() => callOrder.push('participant'));
      const onTick = jest.fn(() => callOrder.push('onTick'));

      service.addParticipant(participant);
      service.start(onTick);
      flushRAF();

      expect(callOrder).toEqual(['participant', 'onTick']);
    });

    it('should call all registered participants every frame', () => {
      const p1 = jest.fn();
      const p2 = jest.fn();
      service.addParticipant(p1);
      service.addParticipant(p2);
      service.start(jest.fn());

      flushRAF();
      expect(p1).toHaveBeenCalledTimes(1);
      expect(p2).toHaveBeenCalledTimes(1);

      flushRAF();
      expect(p1).toHaveBeenCalledTimes(2);
      expect(p2).toHaveBeenCalledTimes(2);
    });

    it('should not call participant after removeParticipant', () => {
      const participant = jest.fn();
      service.addParticipant(participant);
      service.removeParticipant(participant);
      service.start(jest.fn());
      flushRAF();
      expect(participant).not.toHaveBeenCalled();
    });

    it('should not add the same participant function twice', () => {
      const participant = jest.fn();
      service.addParticipant(participant);
      service.addParticipant(participant);
      service.start(jest.fn());
      flushRAF();
      expect(participant).toHaveBeenCalledTimes(1);
    });

    it('should handle removeParticipant for a non-registered function without error', () => {
      expect(() => service.removeParticipant(jest.fn())).not.toThrow();
    });

    it('should allow adding participants after start', () => {
      const participant = jest.fn();
      service.start(jest.fn());
      flushRAF(); // frame 1: no participant yet
      expect(participant).not.toHaveBeenCalled();

      service.addParticipant(participant);
      flushRAF(); // frame 2: participant is registered
      expect(participant).toHaveBeenCalledTimes(1);
    });

    it('should end the frame without calling onTick when a participant stops the scheduler', () => {
      // e.g. the autoscroll participant's placeholder recalculation ends the drag
      const onTick = jest.fn();
      service.addParticipant(() => service.stop());
      service.start(onTick);

      expect(() => flushRAF()).not.toThrow();
      expect(onTick).not.toHaveBeenCalled();
      expect(pendingRAFCount()).toBe(0);
    });

    it('should allow removing participants mid-flight', () => {
      const participant = jest.fn();
      service.addParticipant(participant);
      service.start(jest.fn());

      flushRAF(); // frame 1: participant called
      expect(participant).toHaveBeenCalledTimes(1);

      service.removeParticipant(participant);
      flushRAF(); // frame 2: participant removed
      expect(participant).toHaveBeenCalledTimes(1); // not called again
    });
  });
});
