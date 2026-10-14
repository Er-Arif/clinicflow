const test = require('node:test');
const assert = require('node:assert/strict');
const { keyboardOverlap, focusedInputScrollOffset, createKeyboardVisibility } = require('../src/components/keyboard/visibility.ts');

test('edge-to-edge reserves only actual keyboard overlap; resized roots do not double-inset', () => {
  assert.equal(keyboardOverlap(24, 752, 476), 300);
  assert.equal(keyboardOverlap(24, 452, 476), 0);
  assert.equal(keyboardOverlap(24, 752, Infinity), 0);
  assert.equal(keyboardOverlap(24, 752, 376), 400);
});

test('partial Reason occlusion scrolls the entire input above the pinned footer', () => {
  // The footer has already reduced the measured ScrollView viewport to 300px.
  assert.equal(focusedInputScrollOffset(100, 24, 300, 300, 110), 186);
});

test('already visible inputs stay still; warnings below Reason do not force scrolling to the end', () => {
  assert.equal(focusedInputScrollOffset(186, 24, 300, 214, 110), 186);
  assert.equal(focusedInputScrollOffset(186, 24, 300, 50, 60), 186);
});

test('input growth and later viewport shrink each correct visibility using current measurements', () => {
  assert.equal(focusedInputScrollOffset(100, 24, 300, 264, 60), 100);
  assert.equal(focusedInputScrollOffset(100, 24, 300, 264, 110), 150);
  assert.equal(focusedInputScrollOffset(150, 24, 250, 214, 110), 200);
});

test('an input above the viewport is brought back into view without a negative offset', () => {
  assert.equal(focusedInputScrollOffset(200, 24, 300, -16, 110), 160);
  assert.equal(focusedInputScrollOffset(0, 24, 300, 0, 110), 0);
});

function formHarness({ android = true, footerHeight = 0 } = {}) {
  let nextFrame = 0;
  let offset = 0;
  const frames = new Map();
  const scrolls = [];
  const insets = [];
  const viewport = { top: 24, height: 752 };
  const scrollViewport = { top: 24, height: viewport.height - footerHeight };
  const node = (rect) => ({ measureInWindow: (callback) => callback(0, rect.top, 360, rect.height) });
  const visibility = createKeyboardVisibility({
    android,
    setInset: (inset) => insets.push(inset),
    requestFrame: (callback) => { frames.set(++nextFrame, callback); return nextFrame; },
    cancelFrame: (id) => frames.delete(id),
  });
  visibility.setViewport(node(viewport));
  visibility.setScrollViewport({
    getNativeScrollRef: () => node(scrollViewport),
    scrollTo: ({ y, animated }) => {
      assert.equal(animated, false);
      scrolls.push(y);
      offset = y;
      visibility.setScrollY(y);
    },
  });
  const input = (top, height) => {
    const rect = { top, height };
    return { rect, measureInWindow: (callback) => callback(0, rect.top - offset, 300, rect.height) };
  };
  return {
    visibility, viewport, scrollViewport, input, scrolls, insets, frames,
    flush() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); },
  };
}

test('reusable controller corrects Reset Password after keyboard and pinned-footer layout settle', () => {
  const h = formHarness({ footerHeight: 120 });
  const password = h.input(600, 60);
  h.visibility.focus(password, Infinity);
  h.flush();
  assert.deepEqual(h.scrolls, [4]);
  h.visibility.setKeyboardTop(476);
  h.flush();
  assert.equal(h.insets.at(-1), 300);
  h.scrollViewport.height = h.viewport.height - h.insets.at(-1) - 120;
  h.visibility.schedule(); // native ScrollView onLayout after applying inset
  h.flush();
  assert.equal(h.scrolls.at(-1), 304);
  h.visibility.inputChanged(password);
  h.flush();
  assert.equal(h.scrolls.length, 2, 'Already-visible focused input must stay still');
});

test('reusable controller remeasures multiline growth and changing keyboard heights', () => {
  const h = formHarness();
  h.scrollViewport.height = 300;
  const input = h.input(264, 60);
  h.visibility.focus(input, 400);
  h.flush();
  assert.deepEqual(h.scrolls, []);
  input.rect.height = 110;
  h.visibility.inputChanged(input);
  h.flush();
  assert.deepEqual(h.scrolls, [50]);
  h.scrollViewport.height = 250;
  h.visibility.setKeyboardTop(350);
  h.flush();
  assert.deepEqual(h.scrolls, [50, 100]);
});

test('focus switching ignores old blur events and changes to unfocused fields', () => {
  const h = formHarness();
  h.scrollViewport.height = 300;
  const first = h.input(500, 60);
  const second = h.input(700, 60);
  h.visibility.focus(first, 400);
  h.visibility.focus(second, 400);
  h.visibility.blur(first);
  h.visibility.inputChanged(first);
  assert.equal(h.frames.size, 1);
  h.flush();
  assert.deepEqual(h.scrolls, [436]);
  h.visibility.blur(second);
  h.visibility.inputChanged(second);
  assert.equal(h.frames.size, 0);
});

test('blur, input unmount and screen cleanup invalidate pending native measurements', () => {
  for (const cancel of ['blur', 'cancelPending']) {
    const h = formHarness();
    let measureInput;
    const input = { measureInWindow: (callback) => { measureInput = callback; } };
    h.visibility.focus(input, 400);
    h.flush();
    h.visibility[cancel](input);
    measureInput(0, 900, 300, 60);
    assert.deepEqual(h.scrolls, []);
    assert.equal(h.frames.size, 0);
  }
});

test('keyboard hiding restores the inset; native resize avoids double subtraction', () => {
  const h = formHarness();
  h.viewport.height = 452;
  h.visibility.setKeyboardTop(476);
  h.flush();
  assert.equal(h.insets.at(-1), 0);
  h.viewport.height = 752;
  h.visibility.setKeyboardTop(476);
  h.flush();
  assert.equal(h.insets.at(-1), 300);
  h.visibility.setKeyboardTop(Infinity);
  assert.equal(h.insets.at(-1), 0);
});

test('iOS delegates keyboard inset to KeyboardAvoidingView and only scrolls the measured input', () => {
  const h = formHarness({ android: false });
  h.scrollViewport.height = 300;
  h.visibility.focus(h.input(500, 60), 400);
  h.flush();
  assert.deepEqual(h.insets, []);
  assert.deepEqual(h.scrolls, [236]);
});

test('manual scrolling only updates position; it does not snap the form back', () => {
  const h = formHarness();
  h.visibility.focus(h.input(200, 60), Infinity);
  h.flush();
  h.visibility.setScrollY(100);
  assert.equal(h.frames.size, 0);
  assert.deepEqual(h.scrolls, []);
});
