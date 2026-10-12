import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { useLogoutMutation, useGetSystemInfoQuery, useMeQuery, useListDoctorsQuery } from '@/api/api';
import { clearSessionTokens } from '@/auth/session';
import { AppScreen } from '@/components/AppScreen';
import { resetApiCache } from '@/store/store';
import { colors, radius, spacing } from '@/theme/tokens';

export default function DoctorMoreScreen() {
  const router = useRouter();
  const [logoutMutation, logoutState] = useLogoutMutation();
  const systemInfo = useGetSystemInfoQuery();
  const me = useMeQuery();
  const doctors = useListDoctorsQuery();
  const owner = Boolean(me.data?.roles.includes('OWNER_ADMIN'));

  // Collapsible accordion section states
  // Primary section expanded by default; secondary sections start collapsed
  const [clinicExpanded, setClinicExpanded] = useState(true);
  const [communicationExpanded, setCommunicationExpanded] = useState(false);
  const [adminExpanded, setAdminExpanded] = useState(false);
  const [accountExpanded, setAccountExpanded] = useState(true);
  const [aboutExpanded, setAboutExpanded] = useState(false);

  // ClinicFlow V1 Limitation: V1 is a single-doctor clinic architecture.
  // AuthUser does not carry a doctor_id, and Doctor records are not linked to non-owner users in listDoctors.
  // Therefore the singleton clinic doctor profile (doctors.data[0]) is the authoritative clinic doctor identity.
  const clinicDoctor = doctors.data?.[0];
  const doctorDisplayName = clinicDoctor?.display_name || me.data?.display_name || 'Doctor';

  const handleLogout = async () => {
    try {
      await logoutMutation().unwrap();
    } catch {
      // Clear local session even if network is unavailable
    }
    await clearSessionTokens();
    resetApiCache();
    router.replace('/(auth)/login');
  };

  return (
    <AppScreen>
      <ScrollView contentContainerStyle={{ gap: spacing.md }}>
        <View style={styles.header}>
          <Text style={styles.title}>More</Text>
          <Text style={styles.subtitle}>{doctorDisplayName}</Text>
        </View>

        {/* 1. Clinic & Practice */}
        <AccordionSection
          title="Clinic & Practice"
          expanded={clinicExpanded}
          onToggle={() => setClinicExpanded((prev) => !prev)}
        >
          {owner ? (
            <>
              <MenuItem label="Clinic Settings" onPress={() => router.push('/doctor/settings/clinic')} />
              <MenuItem label="Doctor Settings" onPress={() => router.push('/doctor/settings/doctor')} />
              <MenuItem label="Schedule & Sessions" onPress={() => router.push('/doctor/settings/schedule')} />
              <MenuItem label="Consultation Fees" onPress={() => router.push('/doctor/settings/fees')} />
              <MenuItem label="UPI Payment Configuration" onPress={() => router.push('/doctor/settings/upi')} />
            </>
          ) : (
            <>
              <MenuItem label="Doctor Settings" onPress={() => router.push('/doctor/settings/doctor')} />
              <MenuItem label="Schedule & Sessions" onPress={() => router.push('/doctor/settings/schedule')} />
            </>
          )}
        </AccordionSection>

        {/* 2. Communication */}
        {owner && (
          <AccordionSection
            title="Communication"
            expanded={communicationExpanded}
            onToggle={() => setCommunicationExpanded((prev) => !prev)}
          >
            <MenuItem label="Message Templates" onPress={() => router.push('/doctor/settings/messages')} />
          </AccordionSection>
        )}

        {/* 3. Administration (Owner Only) */}
        {owner && (
          <AccordionSection
            title="Administration"
            expanded={adminExpanded}
            onToggle={() => setAdminExpanded((prev) => !prev)}
          >
            <MenuItem label="User Management" onPress={() => router.push('/doctor/settings/users')} />
            <MenuItem label="Audit History" onPress={() => router.push('/doctor/settings/audit')} />
          </AccordionSection>
        )}

        {/* 4. Account */}
        <AccordionSection
          title="Account"
          expanded={accountExpanded}
          onToggle={() => setAccountExpanded((prev) => !prev)}
        >
          <MenuItem label="Change Password" onPress={() => router.push('/(auth)/change-password')} />
          <MenuItem
            label={logoutState.isLoading ? 'Signing out…' : 'Sign Out'}
            onPress={() => void handleLogout()}
            textStyle={{ color: colors.danger }}
          />
        </AccordionSection>

        {/* 5. About */}
        <AccordionSection
          title="About"
          expanded={aboutExpanded}
          onToggle={() => setAboutExpanded((prev) => !prev)}
        >
          <MenuItem label="About ClinicFlow" onPress={() => router.push('/doctor/settings/about')} />
          <View style={styles.card}>
            <Text style={styles.text}>ClinicFlow V1</Text>
            {systemInfo.data ? (
              <Text style={styles.subtitle}>API: {systemInfo.data.api_version} · {systemInfo.data.environment}</Text>
            ) : null}
          </View>
        </AccordionSection>
      </ScrollView>
    </AppScreen>
  );
}

function AccordionSection({
  title,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.sectionContainer}>
      <Pressable style={styles.sectionHeader} onPress={onToggle}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.accordionIndicator}>{expanded ? '▲' : '▼'}</Text>
      </Pressable>
      {expanded ? <View style={styles.sectionContent}>{children}</View> : null}
    </View>
  );
}

function MenuItem({ label, onPress, textStyle }: { label: string; onPress: () => void; textStyle?: object }) {
  return (
    <Pressable style={styles.card} onPress={onPress}>
      <Text style={[styles.text, textStyle]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: spacing.xs },
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 20 },
  sectionContainer: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  accordionIndicator: { fontSize: 13, color: colors.muted, fontWeight: '700' },
  sectionContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.xs,
  },
  card: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  text: { fontSize: 15, fontWeight: '700', color: colors.text },
});
