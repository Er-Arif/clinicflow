const test = require('node:test');
const assert = require('node:assert/strict');
const { mobileRuntime } = require('./helpers/loadMobile');

function slotTime(index) {
  const minutes = index * 15;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:00`;
}

test('large time picker keeps all 96 slots scrollable, safe-area clear and dismissible', () => {
  let closed = 0;
  const runtime = mobileRuntime({
    'react-native-safe-area-context': {
      useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 48, left: 0 }),
    },
  });
  const { TimeSlotPickerModal } = runtime.load('src/features/appointments/TimeSlotPickerModal.tsx');
  const slots = Array.from({ length: 96 }, (_, index) => ({ time: slotTime(index), disabled: false }));
  const output = runtime.render(TimeSlotPickerModal, {
    visible: true,
    slots,
    selectedTime: '',
    onSelect() {},
    onClose() { closed++; },
  });

  const modal = output.controls.find(control => control.nativeType === 'Modal');
  const scroll = output.controls.find(control => control.nativeType === 'ScrollView');
  const backdrop = output.controls.find(control => control.accessibilityLabel === 'Dismiss time picker');
  const close = output.controls.find(control => control.accessibilityLabel === 'Close time picker');
  const bottomClose = output.controls.find(control => control.label === 'Close');
  const renderedSlots = output.controls.filter(control => control.nativeType === 'Pressable' && /^\d{2}:\d{2} (AM|PM)$/.test(control.label));
  const contentStyle = Object.assign({}, ...[scroll.contentContainerStyle].flat().filter(Boolean));

  assert.equal(typeof modal.onRequestClose, 'function');
  assert.ok(scroll);
  assert.ok(backdrop);
  assert.ok(close);
  assert.equal(bottomClose, undefined);
  assert.equal(renderedSlots.length, 96);
  assert.equal(renderedSlots.at(-1).label, '11:45 PM');
  assert.ok(contentStyle.paddingBottom > 48);

  modal.onRequestClose();
  backdrop.onPress();
  close.onPress();
  assert.equal(closed, 3);
});
