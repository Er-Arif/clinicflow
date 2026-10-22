export type ClinicTime = { clinic_now: string; clinic_date: string; timezone: string };

export function clinicInstant(baseline: ClinicTime, receivedAt: number, now: number): number {
  return Date.parse(baseline.clinic_now) + Math.max(0, now - receivedAt);
}

export function clinicClockParts(instant: number, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  const hour = Number(part('hour'));
  const displayHour = String(hour % 12 || 12).padStart(2, '0');
  const compactDate = new Intl.DateTimeFormat('en-IN', {
    timeZone: timezone, weekday: 'short', day: '2-digit', month: 'short',
  }).format(new Date(instant));
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}:${part('second')}`,
    displayTime: `${displayHour}:${part('minute')} ${hour < 12 ? 'AM' : 'PM'}`,
    compactDate,
    greeting: hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening',
    readableDate: new Intl.DateTimeFormat('en-IN', {
      timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    }).format(new Date(instant)),
  };
}

export const CLINIC_SYNC_INTERVAL = 60_000;

export function startClockTicks(tick: () => void) {
  const timer = setInterval(tick, 1000);
  return () => clearInterval(timer);
}
