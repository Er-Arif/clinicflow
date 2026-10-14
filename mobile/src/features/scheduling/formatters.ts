export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Format a list of active weekday indices (0 = Monday, 6 = Sunday) into
 * a compact, responsive string representation.
 *
 * Rules:
 * - 0 days active: 'No recurring hours active'
 * - all 7 active: 'Every day'
 * - contiguous common ranges: e.g. Monday-Saturday -> 'Mon-Sat', Monday-Friday -> 'Mon-Fri'
 * - otherwise: wrapping compact weekday presentation (e.g. 'Mon, Wed, Fri' or 'Mon-Fri, Sun')
 */
export function formatWorkingDays(dayIndices: number[]): string {
  if (!dayIndices || !Array.isArray(dayIndices) || dayIndices.length === 0) {
    return 'No recurring hours active';
  }

  const validDays = dayIndices.filter(
    (d) => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6
  );

  if (validDays.length === 0) {
    return 'No recurring hours active';
  }

  const uniqueSorted = Array.from(new Set(validDays)).sort((a, b) => a - b);

  if (uniqueSorted.length === 7) {
    return 'Every day';
  }

  // Group into contiguous runs
  const runs: number[][] = [];
  let currentRun: number[] = [uniqueSorted[0]];

  for (let i = 1; i < uniqueSorted.length; i++) {
    const prev = uniqueSorted[i - 1];
    const curr = uniqueSorted[i];
    if (curr === prev + 1) {
      currentRun.push(curr);
    } else {
      runs.push(currentRun);
      currentRun = [curr];
    }
  }
  runs.push(currentRun);

  return runs
    .map((run) => {
      if (run.length >= 3) {
        return `${WEEKDAYS[run[0]]}-${WEEKDAYS[run[run.length - 1]]}`;
      }
      return run.map((d) => WEEKDAYS[d]).join(', ');
    })
    .join(', ');
}
