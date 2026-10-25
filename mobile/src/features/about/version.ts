type ParsedVersion = {
  core: number[];
  prerelease: string[] | null;
};

const VERSION_PATTERN = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function parseVersion(value: string): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(value.trim());
  if (!match) return null;

  const core = match[1].split('.').map((part) => Number(part));
  if (core.some((part) => !Number.isSafeInteger(part) || part < 0)) return null;

  return {
    core,
    prerelease: match[2] ? match[2].split('.') : null,
  };
}

function compareIdentifier(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);

  if (leftNumeric && rightNumeric) {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (leftNumber === rightNumber) return 0;
    return leftNumber > rightNumber ? 1 : -1;
  }
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  if (left === right) return 0;
  return left > right ? 1 : -1;
}

export function compareVersions(leftValue: string, rightValue: string): number | null {
  const left = parseVersion(leftValue);
  const right = parseVersion(rightValue);
  if (!left || !right) return null;

  const coreLength = Math.max(left.core.length, right.core.length);
  for (let index = 0; index < coreLength; index += 1) {
    const leftPart = left.core[index] ?? 0;
    const rightPart = right.core[index] ?? 0;
    if (leftPart !== rightPart) return leftPart > rightPart ? 1 : -1;
  }

  if (!left.prerelease && !right.prerelease) return 0;
  if (!left.prerelease) return 1;
  if (!right.prerelease) return -1;

  const prereleaseLength = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < prereleaseLength; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    const comparison = compareIdentifier(leftPart, rightPart);
    if (comparison !== 0) return comparison;
  }

  return 0;
}
