import type { DoctorToday } from './types';

export function todaySummary(data: DoctorToday, date: string, time: string) {
  if (data.date !== date) return null;
  const checkedIn = data.checked_in.filter(item => item.status === 'CHECKED_IN');
  const upcoming = data.upcoming.filter(item => item.status === 'BOOKED'
    && item.appointment_time !== null && item.appointment_time >= time);
  return {
    appointments: data.total_appointments,
    checkedInCount: data.checked_in_count,
    upcomingCount: Math.max(0, data.upcoming_count - (data.upcoming.length - upcoming.length)),
    checkedIn, upcoming,
  };
}
