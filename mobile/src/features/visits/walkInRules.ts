import type { AvailabilitySession, FeeConfiguration } from '@/features/scheduling/types';

export type WalkInAppointmentType = 'REGULAR' | 'FOLLOW_UP';

export function findActiveWalkInSession(
  sessions: AvailabilitySession[] | undefined,
  clinicNow: string | undefined,
): AvailabilitySession | null {
  const clinicClock = clinicNow?.slice(11, 16) ?? '';
  if (!sessions || !clinicClock) return null;

  return sessions.find(
    (session) => session.start_time.slice(0, 5) <= clinicClock
      && clinicClock < session.end_time.slice(0, 5),
  ) ?? null;
}

export function getSuggestedWalkInFee(
  fee: FeeConfiguration | undefined,
  appointmentType: WalkInAppointmentType,
): string {
  if (!fee) return '';
  return String(
    appointmentType === 'REGULAR' ? fee.regular_fee : fee.followup_fee,
  );
}

export function isWalkInFeeAdjustmentValid(
  adjustFee: boolean,
  adjustedAmount: string,
  reason: string,
): boolean {
  return !adjustFee
    || (/^\d+(\.\d{1,2})?$/.test(adjustedAmount) && reason.trim().length >= 2);
}

export function canSubmitWalkInCapacityOverride(
  sessionFull: boolean,
  isOwner: boolean,
  overrideEnabled: boolean,
  reason: string,
): boolean {
  return !sessionFull
    || (isOwner && overrideEnabled && reason.trim().length >= 2);
}
