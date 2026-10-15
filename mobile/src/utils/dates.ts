export function shiftIsoDate(isoDate: string, days: number): string {
  const value = new Date(`${isoDate}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function startOfIsoWeek(isoDate: string): string {
  const value = new Date(`${isoDate}T00:00:00Z`);
  const weekday = value.getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  return shiftIsoDate(isoDate, mondayOffset);
}

export function startOfIsoMonth(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}

export function formatClinicDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Native date pickers represent calendar fields in device-local Date objects.
// Construct from fields, never parse an ISO date as a UTC instant.
export function pickerDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

export function formatClinicTimestamp(value: string, timezone?: string): string {
  if (!timezone) return 'Clinic time unavailable';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: timezone, day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(value));
}
