import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRouter } from 'expo-router';

import { useMeQuery, useListDoctorsQuery } from '@/api/api';
import { useConfirmedSignOut } from '@/auth/useConfirmedSignOut';
import { AppScreen } from '@/components/AppScreen';
import { colors, radius, spacing } from '@/theme/tokens';

export default function DoctorMoreScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const me = useMeQuery();
  const doctors = useListDoctorsQuery();
  const { confirmSignOut, isSigningOut } = useConfirmedSignOut();
  const owner = Boolean(me.data?.roles.includes('OWNER_ADMIN'));
  const [clinicExpanded, setClinicExpanded] = useState(false);
  const [billingExpanded, setBillingExpanded] = useState(false);
  const [communicationExpanded, setCommunicationExpanded] = useState(false);
  const [adminExpanded, setAdminExpanded] = useState(false);
  const [accountExpanded, setAccountExpanded] = useState(false);

  useEffect(() => {
    const unsubBlur = navigation.addListener('blur', () => {
      setClinicExpanded(false);
      setBillingExpanded(false);
      setCommunicationExpanded(false);
      setAdminExpanded(false);
      setAccountExpanded(false);
    });
    return () => unsubBlur();
  }, [navigation]);

  const clinicDoctor = doctors.data?.[0];
  const doctorDisplayName = clinicDoctor?.display_name || me.data?.display_name || 'Doctor';

  return (
    <AppScreen>
      <View style={styles.header}><Text style={styles.title}>Settings</Text><Text style={styles.subtitle}>{doctorDisplayName}</Text></View>

      <AccordionSection title="Clinic & Practice" expanded={clinicExpanded} onToggle={() => setClinicExpanded(prev => !prev)}>
        {owner ? <MenuItem label="Clinic Settings" onPress={() => router.push('/doctor/more/clinic')} /> : null}
        <MenuItem label="Schedule & Sessions" onPress={() => router.push('/doctor/more/schedule')} />
      </AccordionSection>

      {owner ? (
        <AccordionSection title="Billing & Payments" expanded={billingExpanded} onToggle={() => setBillingExpanded(prev => !prev)}>
          <MenuItem label="Consultation Fees" onPress={() => router.push('/doctor/more/fees')} />
          <MenuItem label="Payment Settings" onPress={() => router.push('/doctor/more/upi')} />
        </AccordionSection>
      ) : null}

      {owner ? <AccordionSection title="Communication" expanded={communicationExpanded} onToggle={() => setCommunicationExpanded(prev => !prev)}><MenuItem label="Message Templates" onPress={() => router.push('/doctor/more/messages')} /></AccordionSection> : null}
      {owner ? <AccordionSection title="Administration" expanded={adminExpanded} onToggle={() => setAdminExpanded(prev => !prev)}><MenuItem label="User Management" onPress={() => router.push('/doctor/more/users')} /><MenuItem label="Audit History" onPress={() => router.push('/doctor/more/audit')} /></AccordionSection> : null}

      <AccordionSection title="Account" expanded={accountExpanded} onToggle={() => setAccountExpanded(prev => !prev)}>
        <MenuItem label="Profile" onPress={() => router.push('/doctor/more/doctor')} />
        <MenuItem label="Change Password" onPress={() => router.push('/(auth)/change-password')} />
        <MenuItem label={isSigningOut ? 'Signing out…' : 'Sign Out'} onPress={confirmSignOut} danger />
      </AccordionSection>

      <DirectItem label="About" onPress={() => router.push('/about')} />
    </AppScreen>
  );
}

function AccordionSection({ title, expanded, onToggle, children }: { title: string; expanded: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <View style={styles.sectionContainer}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }} style={({ pressed }) => [styles.sectionHeader, pressed && styles.pressed]} onPress={onToggle}>
        <Text style={styles.sectionTitle}>{title}</Text>
      </Pressable>
      {expanded ? <View style={styles.sectionContent}>{children}</View> : null}
    </View>
  );
}

function DirectItem({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" style={({ pressed }) => [styles.directItem, pressed && styles.pressed]} onPress={onPress}>
      <Text style={styles.sectionTitle}>{label}</Text><Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

function MenuItem({ label, onPress, danger = false }: { label: string; onPress: () => void; danger?: boolean }) {
  return <Pressable accessibilityRole="button" style={({ pressed }) => [styles.item, pressed && styles.pressed]} onPress={onPress}><Text style={[styles.text, danger && styles.danger]}>{label}</Text><Text style={styles.chevron}>›</Text></Pressable>;
}

const styles = StyleSheet.create({
  header: { gap: 2, marginBottom: 2 },
  title: { fontSize: 25, fontWeight: '800', color: colors.primaryDark },
  subtitle: { color: colors.muted, fontSize: 13 },
  sectionContainer: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  sectionHeader: { minHeight: 54, justifyContent: 'center', paddingHorizontal: spacing.md, paddingVertical: 12 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: colors.primaryDark },
  sectionContent: { borderTopWidth: 1, borderTopColor: colors.border },
  directItem: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  item: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, backgroundColor: colors.surfaceSoft },
  text: { fontSize: 14, fontWeight: '600', color: colors.text },
  danger: { color: colors.danger },
  chevron: { color: colors.muted, fontSize: 20 },
  pressed: { opacity: 0.72 },
});
