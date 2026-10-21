const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const read = (file) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
const parse = (file) => ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(node, predicate) {
  const result = [];
  function visit(child) {
    if (predicate(child)) result.push(child);
    ts.forEachChild(child, visit);
  }
  visit(node);
  return result;
}
const tag = (node) => ts.isJsxElement(node) ? node.openingElement.tagName.getText() : ts.isJsxSelfClosingElement(node) ? node.tagName.getText() : '';

test('Reset password registers both password and reason inside the reusable form viewport', () => {
  const source = parse('app/doctor/more/users/[userId].tsx');
  const forms = find(source, (node) => tag(node) === 'KeyboardSafeFormScreen');
  assert.equal(forms.length, 1);
  const inputs = find(forms[0], (node) => tag(node) === 'FormField');
  assert.equal(inputs.length, 4);
  const password = inputs.find(node => node.getText().includes('label="Temporary password"'));
  assert.ok(password);
  assert.ok(password.getText().includes('secureTextEntry'), 'Secure input semantics must be retained');
  assert.ok(password.getText().includes('onChangeText={setTemporaryPassword}'));
  assert.ok(inputs.some(node => node.getText().includes('onChangeText={setResetReason}')));
});

test('Block a date uses the same viewport and supplies both pinned actions', () => {
  const source = parse('app/doctor/more/schedule/exceptions/new.tsx');
  const form = find(source, (node) => tag(node) === 'KeyboardSafeFormScreen')[0];
  assert.ok(form);
  const footer = form.openingElement.attributes.properties.find(property => property.name?.getText() === 'footer');
  assert.ok(footer.getText().includes('label="Save blocked date"'));
  assert.ok(footer.getText().includes('label="Cancel"'));
  assert.ok(find(form, (node) => tag(node) === 'FormField').some(node => node.getText().includes('label="Reason"')));
  assert.equal(find(source, (node) => tag(node) === 'ScrollView').length, 0, 'Route must not duplicate the shared scroll viewport');
});

function routes(dir = path.resolve(__dirname, '../app')) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? routes(file) : file.endsWith('.tsx') ? [file] : [];
  });
}

test('all editable route branches opt in; read-only routes do not acquire a keyboard container', () => {
  const editable = new Set(['KeyboardSafeTextInput', 'FormField', 'PatientForm']);
  let formRoutes = 0;
  for (const file of routes()) {
    const text = fs.readFileSync(file, 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    assert.equal(find(source, node => tag(node) === 'TextInput').length, 0, `${file}: unregistered native input`);
    const inputs = find(source, node => editable.has(tag(node)));
    const forms = find(source, node => tag(node) === 'KeyboardSafeFormScreen');
    if (inputs.length) formRoutes++;
    else assert.equal(forms.length, 0, `${file}: noneditable screen should keep AppScreen`);
    for (const input of inputs) {
      let parent = input.parent;
      while (parent && tag(parent) !== 'KeyboardSafeFormScreen') parent = parent.parent;
      assert.ok(parent, `${file}: editable input must belong to its own form viewport`);
    }
  }
  // Cancellation editing now lives inside AppointmentCancellationModal rather than the appointment route.
  assert.equal(formRoutes, 24);
});

test('shared input composes consumer events and FormField uses the native input adapter', () => {
  const input = read('src/components/KeyboardSafeTextInput.tsx');
  for (const event of ['onFocus', 'onBlur', 'onLayout', 'onContentSizeChange', 'onSelectionChange']) {
    assert.ok(input.includes(`${event}?.(event)`), `${event} callback must be preserved`);
  }
  assert.ok(input.includes('visibility?.focus(inputRef.current'));
  assert.ok(input.includes('visibility?.blur(inputRef.current'));
  assert.ok(input.includes('visibility?.inputChanged(inputRef.current)'));
  const field = read('src/components/FormField.tsx');
  assert.ok(field.includes('<KeyboardSafeTextInput'));
  assert.ok(field.includes('ref={inputRef}'));
});

test('keyboard behavior is opt-in and the canonical helper has replaced scheduling-only geometry', () => {
  const appScreen = read('src/components/AppScreen.tsx');
  assert.ok(!appScreen.includes('Keyboard.addListener'));
  assert.ok(!appScreen.includes('keyboardHeight'));
  assert.ok(!fs.existsSync(path.resolve(__dirname, '../src/features/scheduling/keyboardVisibility.ts')));
  const shared = read('src/components/KeyboardSafeFormScreen.tsx');
  assert.ok(read('src/components/keyboard/visibility.ts').includes('getNativeScrollRef()'));
  assert.ok(shared.includes('keyboardShouldPersistTaps="handled"'));
  assert.ok(shared.includes('keyboardDismissMode="on-drag"'));
  assert.ok(read('src/navigation/tabOptions.tsx').includes('tabBarHideOnKeyboard: true'));
});
