import { Image, StyleSheet } from 'react-native';

export function ClinicFlowLogo() {
  return (
    <Image
      source={require('../../assets/clinicflow-lockup.png')}
      style={styles.logo}
      resizeMode="contain"
      accessibilityLabel="ClinicFlow"
    />
  );
}

const styles = StyleSheet.create({
  logo: {
    width: '92%',
    maxWidth: 390,
    height: 104,
    alignSelf: 'center',
  },
});
