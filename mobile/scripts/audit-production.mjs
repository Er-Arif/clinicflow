import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(scriptDir, '..');
const sourceRoots = [
  path.join(mobileRoot, 'app'),
  path.join(mobileRoot, 'src'),
];

const allowedAdvisories = {
  'node-forge': {
    advisory: 'GHSA-86w9-cpqp-85rv',
    reason: 'Expo CLI/code-signing build tooling; upstream currently has no patched node-forge release.',
    validate(vulnerability) {
      if (vulnerability.isDirect) return false;
      const effects = new Set(vulnerability.effects ?? []);
      const allowedEffects = new Set(['@expo/cli', '@expo/code-signing-certificates']);
      return effects.size > 0 && [...effects].every((effect) => allowedEffects.has(effect));
    },
  },
  zod: {
    advisory: 'GHSA-mrhx-c7xc-m3w5',
    reason: 'Expo CLI includes an affected nested Zod release; ClinicFlow does not import Zod at runtime.',
    validate() {
      return !sourceImportsPackage('zod');
    },
  },
};

const result = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
  cwd: mobileRoot,
  encoding: 'utf8',
  shell: process.platform === 'win32',
});

if (result.error) {
  throw result.error;
}

let report;
try {
  report = JSON.parse(result.stdout || '{}');
} catch {
  process.stderr.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  throw new Error('npm audit did not return valid JSON.');
}

if (report.error) {
  throw new Error(`npm audit failed: ${report.error.summary ?? report.error.message ?? 'unknown error'}`);
}

const blocked = [];
const accepted = [];

for (const [name, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
  if (!['high', 'critical'].includes(vulnerability.severity)) continue;

  const advisoryIds = advisoryIdsOf(vulnerability);
  const exception = allowedAdvisories[name];
  const allowed =
    exception
    && advisoryIds.size === 1
    && advisoryIds.has(exception.advisory)
    && exception.validate(vulnerability);

  if (allowed) {
    accepted.push(`${name} (${exception.advisory}): ${exception.reason}`);
  } else {
    blocked.push({ name, vulnerability, advisoryIds: [...advisoryIds] });
  }
}

for (const item of accepted) {
  console.warn(`Accepted temporary production-audit exception: ${item}`);
}

if (blocked.length > 0) {
  console.error('Blocking high/critical production dependency advisories:');
  for (const item of blocked) {
    console.error(
      `- ${item.name}: severity=${item.vulnerability.severity}; advisories=${item.advisoryIds.join(', ') || 'unknown'}; nodes=${(item.vulnerability.nodes ?? []).join(', ') || 'unknown'}`,
    );
  }
  process.exit(1);
}

console.log(
  `Production dependency audit passed with ${accepted.length} narrowly scoped temporary exception(s).`,
);

function advisoryIdsOf(vulnerability) {
  const ids = new Set();
  for (const item of vulnerability.via ?? []) {
    if (typeof item === 'string') continue;
    const url = item?.url ?? '';
    const match = url.match(/GHSA-[0-9a-z-]+/i);
    if (match) ids.add(match[0].toUpperCase());
  }
  return ids;
}

function sourceImportsPackage(packageName) {
  const importPattern = new RegExp(
    String.raw`(?:from\s*['"]${escapeRegex(packageName)}['"]|require\(\s*['"]${escapeRegex(packageName)}['"]\s*\)|import\(\s*['"]${escapeRegex(packageName)}['"]\s*\))`,
  );

  for (const root of sourceRoots) {
    if (!fs.existsSync(root)) continue;
    for (const file of walk(root)) {
      if (!/\.(?:js|jsx|ts|tsx|mjs|cjs)$/.test(file)) continue;
      if (importPattern.test(fs.readFileSync(file, 'utf8'))) return true;
    }
  }
  return false;
}

function* walk(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) yield* walk(fullPath);
    else if (entry.isFile()) yield fullPath;
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
