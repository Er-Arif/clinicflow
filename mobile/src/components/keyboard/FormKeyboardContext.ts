import { createContext, useContext } from 'react';

import type { KeyboardVisibility } from './visibility';

export const FormKeyboardContext = createContext<{
  visibility: KeyboardVisibility;
  viewportHeight: number;
} | null>(null);

export function useFormKeyboard() {
  return useContext(FormKeyboardContext);
}
