/* global __dirname */
// Execute actual TS/TSX modules with Node's test runner. Only native platform
// boundaries are substituted; React rendering, editor logic and RTK are real.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '../..');

function mobileRuntime(overrides = {}) {
  const cache = new Map();
  let controls = [];
  const text = value => Array.isArray(value) ? value.map(text).join('')
    : React.isValidElement(value) ? text(value.props.children) : value == null ? '' : String(value);
  const host = name => function NativeHost(props) {
    controls.push({ ...props, nativeType: name, label: props.accessibilityLabel ?? text(props.children) });
    return React.createElement('div', { 'data-native': name, 'aria-label': props.accessibilityLabel },
      name === 'TextInput' ? props.value : props.children);
  };
  const native = Object.fromEntries(['View', 'Text', 'Pressable', 'ScrollView', 'TextInput', 'Modal',
    'KeyboardAvoidingView', 'ActivityIndicator', 'RefreshControl'].map(name => [name, host(name)]));
  native.StyleSheet = { create: styles => styles, flatten: style => Object.assign({}, ...[style].flat().filter(Boolean)) };
  native.Platform = { OS: 'android' };
  native.Keyboard = { dismiss() {}, metrics: () => undefined };
  native.BackHandler = { addEventListener: () => ({ remove() {} }) };
  const expoRouter = {
    useRouter: () => ({ back() {}, push() {}, replace() {}, dismissTo() {}, dismissAll() {} }),
    useLocalSearchParams: () => ({}),
    useFocusEffect: () => {},
  };
  const mocks = {
    '@/api/config': { getApiUrl: () => 'https://api.test.invalid' },
    'react-native': native,
    'react-native-safe-area-context': {
      SafeAreaView: host('SafeAreaView'),
      useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
    },
    '@react-native-community/datetimepicker': host('DateTimePicker'),
    'expo-router': expoRouter,
    'expo-secure-store': { getItemAsync: async () => null },
    ...overrides,
  };
  if (overrides['expo-router']) mocks['expo-router'] = { ...expoRouter, ...overrides['expo-router'] };
  function load(file) {
    let resolved = path.resolve(root, file);
    if (!fs.existsSync(resolved)) resolved = [resolved + '.ts', resolved + '.tsx', resolved + '.js'].find(fs.existsSync);
    if (!resolved) throw Error(`Cannot resolve ${file}`);
    if (cache.has(resolved)) return cache.get(resolved).exports;
    const module = { exports: {} };
    cache.set(resolved, module);
    const compiled = ts.transpileModule(fs.readFileSync(resolved, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: resolved,
    }).outputText;
    const localRequire = name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith('@/')) return load('src/' + name.slice(2));
      if (name.startsWith('.')) return load(path.resolve(path.dirname(resolved), name));
      return require(name);
    };
    new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
    return module.exports;
  }
  return {
    load,
    render(Component, props) {
      controls = [];
      const markup = renderToStaticMarkup(React.createElement(Component, props));
      return { markup, controls: [...controls] };
    },
  };
}

module.exports = { mobileRuntime };
