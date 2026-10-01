import { optimizeSchedule } from './scheduler';
import { Family, FamilyWish, Shift, ShiftType } from './types';

type Result = ReturnType<typeof optimizeSchedule>;

/**
 * Runs optimizeSchedule in a Web Worker (keeps the UI responsive). Falls back to running
 * it directly if workers aren't available.
 */
export function runOptimizer(args: {
  shifts: Shift[];
  families: Family[];
  shiftTypes: ShiftType[];
  wishes: Record<string, FamilyWish>;
  startDate: string;
  endDate: string;
}): Promise<Result> {
  const runInline = () =>
    optimizeSchedule(args.shifts, args.families, args.shiftTypes, args.wishes, args.startDate, args.endDate);

  if (typeof Worker === 'undefined') return Promise.resolve(runInline());

  return new Promise<Result>(resolve => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./optimizer.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      resolve(runInline());
      return;
    }
    worker.onmessage = (e: MessageEvent) => {
      worker.terminate();
      if (e.data?.ok) resolve(e.data.result as Result);
      else resolve(runInline());
    };
    worker.onerror = () => {
      worker.terminate();
      resolve(runInline());
    };
    worker.postMessage(JSON.parse(JSON.stringify(args)));
  });
}
