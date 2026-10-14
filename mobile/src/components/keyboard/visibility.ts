// Coordinates come from measureInWindow and the native keyboard event.
export function keyboardOverlap(top: number, height: number, keyboardTop: number) {
  return Math.min(height, Math.max(0, top + height - keyboardTop));
}

export function focusedInputScrollOffset(
  scrollY: number,
  viewportTop: number,
  viewportHeight: number,
  inputTop: number,
  inputHeight: number,
) {
  const overflow = inputTop + inputHeight - (viewportTop + viewportHeight);
  const delta = overflow > 0 ? overflow : Math.min(0, inputTop - viewportTop);
  return Math.max(0, scrollY + delta);
}

export type MeasurableInput = {
  measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void;
};

type VisibilityPorts = {
  android: boolean;
  setInset: (inset: number) => void;
  requestFrame: (callback: () => void) => number;
  cancelFrame: (frame: number) => void;
};

type ScrollViewport = {
  getNativeScrollRef: () => MeasurableInput | null;
  scrollTo: (options: { y: number; animated: boolean }) => void;
};

// The screen owns one controller; inputs register only while focused.
// Native measurement and frame scheduling are injected so races can be tested.
export function createKeyboardVisibility(ports: VisibilityPorts) {
  let viewport: MeasurableInput | null = null;
  let scrollViewport: ScrollViewport | null = null;
  let activeInput: MeasurableInput | null = null;
  let scrollY = 0;
  let keyboardTop = Infinity;
  let frame: number | null = null;
  let measurement = 0;

  function cancelPending() {
    ++measurement;
    if (frame !== null) ports.cancelFrame(frame);
    frame = null;
  }

  function schedule() {
    cancelPending();
    const currentMeasurement = measurement;
    frame = ports.requestFrame(() => {
      frame = null;
      // This outer view keeps its bounds when its keyboard padding changes.
      if (ports.android) {
        viewport?.measureInWindow((_x, top, _width, height) => {
          if (currentMeasurement !== measurement || height <= 0) return;
          ports.setInset(keyboardOverlap(top, height, keyboardTop));
        });
      }
      const input = activeInput;
      if (!input) return;
      // The native ScrollView bounds already exclude the optional pinned footer.
      scrollViewport?.getNativeScrollRef()?.measureInWindow((_x, top, _width, height) => {
        if (currentMeasurement !== measurement || height <= 0) return;
        input.measureInWindow((_inputX, inputTop, _inputWidth, inputHeight) => {
          if (currentMeasurement !== measurement || activeInput !== input || inputHeight <= 0) return;
          const y = focusedInputScrollOffset(scrollY, top, height, inputTop, inputHeight);
          if (y !== scrollY) scrollViewport?.scrollTo({ y, animated: false });
        });
      });
    });
  }

  return {
    schedule,
    cancelPending,
    setViewport(node: MeasurableInput | null) {
      viewport = node;
      if (!node) cancelPending();
    },
    setScrollViewport(node: ScrollViewport | null) {
      scrollViewport = node;
      if (!node) cancelPending();
    },
    setKeyboardTop(top: number) {
      keyboardTop = top;
      if (top === Infinity) ports.setInset(0);
      schedule();
    },
    setScrollY(y: number) {
      scrollY = y;
    },
    focus(input: MeasurableInput, top: number) {
      activeInput = input;
      keyboardTop = top;
      schedule();
    },
    blur(input: MeasurableInput) {
      // A delayed blur from the previous field must not unregister the new one.
      if (activeInput === input) {
        activeInput = null;
        cancelPending();
      }
    },
    inputChanged(input: MeasurableInput) {
      if (activeInput === input) schedule();
    },
  };
}

export type KeyboardVisibility = ReturnType<typeof createKeyboardVisibility>;
