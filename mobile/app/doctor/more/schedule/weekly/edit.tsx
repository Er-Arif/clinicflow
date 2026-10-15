import { useState } from 'react';
import { Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useGetScheduleOverviewQuery, useListDoctorsQuery, usePreviewScheduleImpactMutation, useSmartApplyScheduleMutation } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import type { ScheduleOverview } from '@/features/scheduling/types';
import { WeeklyScheduleEditor } from '@/features/scheduling/WeeklyScheduleEditor';
import { createWeeklyEditor, initialDraft, weekdays } from '@/features/scheduling/weeklyEditor';
import { colors } from '@/theme/tokens';

// Cache refreshes must never overwrite in-progress edits. The backend revalidates
// every preview/apply against current state.
function LoadedEditor({ overview, weekday }: { overview: ScheduleOverview; weekday?: string | string[] }) {
  const router = useRouter();
  const [preview] = usePreviewScheduleImpactMutation();
  const [apply] = useSmartApplyScheduleMutation();
  const [editor] = useState(() => createWeeklyEditor(initialDraft(overview, weekday), {
    preview: body => preview({ doctorId: overview.doctor_id, body }).unwrap(),
    apply: body => apply({ doctorId: overview.doctor_id, body }).unwrap(),
    onApplied: () => router.dismissTo({ pathname: '/doctor/more/schedule/weekly', params: { saved: '1', doctorId: overview.doctor_id } }),
  }));
  const [loadedFrom] = useState(() => {
    const day = overview.days.find(d => d.weekday === initialDraft(overview, weekday).weekdays[0]);
    return `${weekdays[day?.weekday ?? 0]} ${day?.upcoming ? 'planned hours' : day?.current ? 'current hours' : 'default hours'}`;
  });
  return <WeeklyScheduleEditor editor={editor} overview={overview} loadedFrom={loadedFrom} onBack={() => router.back()} />;
}

export default function WeeklyScheduleEditScreen() {
  const { weekday, doctorId: requestedDoctor } = useLocalSearchParams<{ weekday?: string; doctorId?: string }>();
  const doctors = useListDoctorsQuery();
  const doctorId = doctors.data?.find(d => d.doctor_id === requestedDoctor)?.doctor_id ?? doctors.data?.[0]?.doctor_id ?? '';
  const overview = useGetScheduleOverviewQuery(doctorId, { skip: !doctorId, refetchOnMountOrArgChange: true });
  if (!overview.data) return <AppScreen>
    <BackButton />
    <Text style={{ color: colors.text }}>
      {doctors.isError || overview.isError ? 'Unable to load weekly hours.' : doctors.data?.length === 0 ? 'No doctor is configured.' : 'Loading weekly hours…'}
    </Text>
    {doctors.isError || overview.isError ? <AppButton label="Retry" onPress={() => { if (doctorId) void overview.refetch(); else void doctors.refetch(); }} /> : null}
  </AppScreen>;
  return <LoadedEditor key={doctorId} overview={overview.data} weekday={weekday} />;
}
