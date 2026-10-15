import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { useClinicTimeQuery } from '@/api/api';
import { CLINIC_SYNC_INTERVAL, clinicClockParts, clinicInstant, startClockTicks } from './clinicClock';

export function useClinicClock() {
  const query = useClinicTimeQuery(undefined, {
    pollingInterval: CLINIC_SYNC_INTERVAL, skipPollingIfUnfocused: true, refetchOnMountOrArgChange: true,
  });
  const [now, setNow] = useState(Date.now);
  const { refetch } = query;
  useEffect(() => {
    const stop = startClockTicks(() => setNow(Date.now()));
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') { setNow(Date.now()); void refetch(); }
    });
    return () => { stop(); subscription.remove(); };
  }, [refetch]);
  const clock = query.data && query.fulfilledTimeStamp
    ? clinicClockParts(clinicInstant(query.data, query.fulfilledTimeStamp, now), query.data.timezone)
    : null;
  return { clock, query };
}
