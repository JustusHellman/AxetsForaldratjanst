// Runs the schedule optimizer off the main thread so the page stays responsive.
import { optimizeSchedule } from './scheduler';

self.onmessage = (e: MessageEvent) => {
  const { shifts, families, shiftTypes, wishes, startDate, endDate } = e.data;
  try {
    const result = optimizeSchedule(shifts, families, shiftTypes, wishes, startDate, endDate);
    (self as unknown as Worker).postMessage({ ok: true, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: String(err) });
  }
};
