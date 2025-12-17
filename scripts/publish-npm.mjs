import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';

const repoRoot = process.cwd();
const tokenPath = join(repoRoot, 'publish.token');

if (!existsSync(tokenPath)) {
  console.error(`publish.token not found at: ${tokenPath}`);
  process.exit(1);
}

const token = readFileSync(tokenPath, 'utf8').trim();
if (!token) {
  console.error('publish.token is empty');
  process.exit(1);
}

const tempDir = mkdtempSync(join(tmpdir(), 'npm-publish-'));
const npmrcPath = join(tempDir, '.npmrc');

try {
  writeFileSync(
    npmrcPath,
    `registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=${token}\nalways-auth=true\n`,
    'utf8'
  );

  const result = spawnSync('npm', ['publish', '--userconfig', npmrcPath], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    cwd: repoRoot,
  });

  process.exit(result.status ?? 1);
} finally {
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
