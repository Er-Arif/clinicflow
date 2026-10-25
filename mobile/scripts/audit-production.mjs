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
    advisory: normalizeAdvisoryId('GHSA-86w9-cpqp-85rv'),
    reason: 'Expo CLI/code-signing build tooling; upstream currently has no patched node-forge release.',
    validate(vulnerability) {
      if (vulnerability.isDirect) return false;
      const effects = new Set(vulnerability.effects ?? []);
      const allowedEffects = new Set(['@expo/cli', '@expo/code-signing-certificates']);
      return effects.size > 0 && [...effects].every((effect) => allowedEffects.has(effect));
    },
  },
  zod: {
    advisory: normalizeAdvisoryId('GHSA-mrhx-c7xc-m3w5'),
    reason: 'Expo CLI carries a nested affected Zod 3.x used only by build tooling; ClinicFlow runtime Zod remains patched.',
    validate(vulnerability) {
      if (vulnerability.isDirect) return false;
      const nodes = vulnerability.nodes ?? [];
      return nodes.length > 0
        && nodes.every((node) => node === 'node_modules/expo/node_modules/zod');
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
const vulnerabilities = report.vulnerabilities ?? {};

for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
  if (!['high', 'critical'].includes(vulnerability.severity)) continue;

  const resolution = resolveAllowedVulnerability(name, new Set());
  if (resolution.allowed) {
    accepted.push(`${name}: ${resolution.reason}`);
  } else {
    blocked.push({
      name,
      vulnerability,
      advisoryIds: [...resolution.advisoryIds],
      reason: resolution.reason,
    });
  }
}

for (const item of accepted) {
  console.warn(`Accepted temporary production-audit exception: ${item}`);
}

if (blocked.length > 0) {
  console.error('Blocking high/critical production dependency advisories:');
  for (const item of blocked) {
    console.error(
      `- ${item.name}: severity=${item.vulnerability.severity}; advisories=${item.advisoryIds.join(', ') || 'unknown'}; nodes=${(item.vulnerability.nodes ?? []).join(', ') || 'unknown'}; reason=${item.reason}`,
    );
  }
  process.exit(1);
}

console.log(
  `Production dependency audit passed with ${accepted.length} narrowly scoped temporary exception(s).`,
);

function resolveAllowedVulnerability(name, seen) {
  if (seen.has(name)) {
    return {
      allowed: false,
      advisoryIds: new Set(),
      reason: `cyclic vulnerability chain detected at ${name}`,
    };
  }

  const vulnerability = vulnerabilities[name];
  if (!vulnerability) {
    return {
      allowed: false,
      advisoryIds: new Set(),
      reason: `npm audit referenced missing vulnerability ${name}`,
    };
  }

  const nextSeen = new Set(seen);
  nextSeen.add(name);

  const directAdvisories = advisoryIdsOf(vulnerability);
  const dependencyNames = (vulnerability.via ?? []).filter((item) => typeof item === 'string');
  const advisoryIds = new Set(directAdvisories);
  const reasons = [];

  let directAllowed = true;
  if (directAdvisories.size > 0) {
    const exception = allowedAdvisories[name];
    directAllowed = Boolean(
      exception
      && directAdvisories.size === 1
      && directAdvisories.has(exception.advisory)
      && exception.validate(vulnerability),
    );

    if (directAllowed) {
      reasons.push(`${name} (${exception.advisory}): ${exception.reason}`);
    } else {
      reasons.push(`no valid direct exception for ${name}`);
    }
  }

  let dependenciesAllowed = true;
  for (const dependencyName of dependencyNames) {
    const dependency = vulnerabilities[dependencyName];
    if (!dependency || !['high', 'critical'].includes(dependency.severity)) continue;

    const resolution = resolveAllowedVulnerability(dependencyName, nextSeen);
    for (const advisoryId of resolution.advisoryIds) advisoryIds.add(advisoryId);
    dependenciesAllowed &&= resolution.allowed;
    reasons.push(resolution.reason);
  }

  const hasTraceableCause = directAdvisories.size > 0 || dependencyNames.length > 0;
  return {
    allowed: hasTraceableCause && directAllowed && dependenciesAllowed,
    advisoryIds,
    reason: reasons.filter(Boolean).join(' -> ') || `no traceable advisory cause for ${name}`,
  };
}

function advisoryIdsOf(vulnerability) {
  const ids = new Set();
  for (const item of vulnerability.via ?? []) {
    if (typeof item === 'string') continue;
    const url = item?.url ?? '';
    const match = url.match(/GHSA-[0-9a-z-]+/i);
    if (match) ids.add(normalizeAdvisoryId(match[0]));
  }
  return ids;
}

function normalizeAdvisoryId(value) {
  return value.toUpperCase();
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
