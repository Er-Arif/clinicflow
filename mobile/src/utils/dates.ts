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
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
