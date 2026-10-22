import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { RolePreset } from '@/features/admin/types';
import { colors, radius, spacing } from '@/theme/tokens';

function sentenceCase(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : value;
}

export function RolePicker({ roles, selected, onChange }: { roles: RolePreset[]; selected: string[]; onChange: (roles: string[]) => void }) {
  function toggle(code: string) {
    const next = selected.includes(code) ? selected.filter((item) => item !== code) : [...selected, code];
    onChange(next);
  }
  return (
    <View style={styles.wrap}>
      {roles.map((role) => {
        const active = selected.includes(role.role_code);
        return (
          <Pressable key={role.role_code} onPress={() => toggle(role.role_code)} style={[styles.item, active && styles.active]}>
            <Text style={[styles.text, active && styles.activeText]}>{sentenceCase(role.display_name)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  item: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: colors.surface },
  active: { borderColor: colors.primary, backgroundColor: colors.softPrimary },
  text: { color: colors.text, fontWeight: '700' },
  activeText: { color: colors.primary },
});
