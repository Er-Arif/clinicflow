import { getInitialRouteForRoles, isDoctorOrOwner, isAssistantRole } from './roles';

function assertEqual(actual: unknown, expected: unknown, message?: string) {
  if (actual !== expected) {
    throw new Error(`Assertion failed: expected ${expected}, got ${actual}. ${message ?? ''}`);
  }
}

// 1. OWNER_ADMIN + ASSISTANT -> Doctor shell wins
assertEqual(
  getInitialRouteForRoles(['OWNER_ADMIN', 'ASSISTANT']),
  '/doctor/today',
  'OWNER_ADMIN + ASSISTANT must route to /doctor/today',
);
assertEqual(isDoctorOrOwner(['OWNER_ADMIN', 'ASSISTANT']), true);

// 2. DOCTOR + ASSISTANT -> Doctor shell wins
assertEqual(
  getInitialRouteForRoles(['DOCTOR', 'ASSISTANT']),
  '/doctor/today',
  'DOCTOR + ASSISTANT must route to /doctor/today',
);
assertEqual(isDoctorOrOwner(['DOCTOR', 'ASSISTANT']), true);

// 3. ASSISTANT only -> Assistant shell
assertEqual(
  getInitialRouteForRoles(['ASSISTANT']),
  '/assistant/home',
  'ASSISTANT only must route to /assistant/home',
);
assertEqual(isDoctorOrOwner(['ASSISTANT']), false);
assertEqual(isAssistantRole(['ASSISTANT']), true);

// 4. DOCTOR only -> Doctor shell
assertEqual(
  getInitialRouteForRoles(['DOCTOR']),
  '/doctor/today',
  'DOCTOR only must route to /doctor/today',
);

// 5. OWNER_ADMIN only -> Doctor shell
assertEqual(
  getInitialRouteForRoles(['OWNER_ADMIN']),
  '/doctor/today',
  'OWNER_ADMIN only must route to /doctor/today',
);

// 6. Empty / unauthorized roles -> Login redirect
assertEqual(getInitialRouteForRoles([]), '/(auth)/login');
assertEqual(getInitialRouteForRoles(['BILLING_CLERK']), '/(auth)/login');

console.log('Role precedence assertions passed cleanly (6/6).');
