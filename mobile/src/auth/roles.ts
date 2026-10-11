/**
 * ClinicFlow V1 Role Shell Precedence Rules:
 *
 * 1. OWNER_ADMIN or DOCTOR -> '/doctor/today' (Doctor shell takes precedence even if ASSISTANT is also present)
 * 2. ASSISTANT -> '/assistant/home'
 * 3. Otherwise -> '/(auth)/login'
 */
export function getInitialRouteForRoles(roles: string[] = []): string {
  if (roles.some((role) => ['DOCTOR', 'OWNER_ADMIN'].includes(role))) {
    return '/doctor/today';
  }
  if (roles.includes('ASSISTANT')) {
    return '/assistant/home';
  }
  return '/(auth)/login';
}

export function isDoctorOrOwner(roles: string[] = []): boolean {
  return roles.some((role) => ['DOCTOR', 'OWNER_ADMIN'].includes(role));
}

export function isAssistantRole(roles: string[] = []): boolean {
  return roles.includes('ASSISTANT');
}
