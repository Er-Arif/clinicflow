export function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function pickerDate(value?: string) {
  if (!value || !isIsoDate(value)) return new Date();
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function formatClinicDate(value?: string | null) {
  if (!value || !isIsoDate(value)) return value || '—';
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, day, 12)));
}

export function formatCompactClinicDate(value?: string | null) {
  if (!value || !isIsoDate(value)) return value || '—';
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, day, 12)));
}

export function formatClinicTime(value?: string | null) {
  if (!value) return '—';
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return value;
  const hour = Number(match[1]);
  const minute = match[2];
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return value;
  const displayHour = String(hour % 12 || 12).padStart(2, '0');
  return `${displayHour}:${minute} ${hour < 12 ? 'AM' : 'PM'}`;
}

export function formatClinicTimeRange(start?: string | null, end?: string | null) {
  if (!start || !end) return '—';
  return `${formatClinicTime(start)} – ${formatClinicTime(end)}`;
}

export function formatClinicTimestamp(value?: string | null, timeZone = 'Asia/Kolkata') {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const datePart = new Intl.DateTimeFormat('en-IN', {
    timeZone, day: '2-digit', month: 'short', year: 'numeric',
  }).format(date);
  const timePart = new Intl.DateTimeFormat('en-US', {
    timeZone, hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(date);
  return `${datePart}, ${timePart}`;
}

export function startOfIsoWeek(value: string) {
  if (!isIsoDate(value)) return value;
  const date = new Date(`${value}T12:00:00Z`);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
  return date.toISOString().slice(0, 10);
}

export function startOfIsoMonth(value: string) {
  return isIsoDate(value) ? `${value.slice(0, 8)}01` : value;
}
