#!/usr/bin/env node
/**
 * Browser-based PDF Testing Script
 * 
 * Runs Playwright tests to test PDF conversion in a real browser environment
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const outputDir = join(__dirname, '..', 'test-outputs');
if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true });
}

console.log('🧪 Running PDF conversion tests in browser...\n');

try {
  // Run Playwright tests
  execSync('pnpm exec playwright test tests/browser/pdf-conversion.spec.ts --reporter=list,json', {
    stdio: 'inherit',
    cwd: join(__dirname, '..'),
  });
  
  console.log('\n✅ All browser tests completed!');
  console.log('📊 Check test-results/ directory for detailed reports');
} catch (error) {
  console.error('\n❌ Some tests failed. Check the output above for details.');
  process.exit(1);
}

