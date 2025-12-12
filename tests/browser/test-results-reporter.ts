/**
 * Custom Playwright reporter for generating detailed test results
 */
import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

interface TestReport {
  timestamp: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    duration: number;
  };
  tests: Array<{
    title: string;
    status: 'passed' | 'failed' | 'skipped';
    duration: number;
    error?: string;
    results?: any;
  }>;
}

export default class TestResultsReporter implements Reporter {
  private report: TestReport = {
    timestamp: new Date().toISOString(),
    summary: {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      duration: 0,
    },
    tests: [],
  };

  onBegin(config: FullConfig, suite: Suite) {
    console.log(`\n🧪 Running ${suite.allTests().length} test(s)\n`);
  }

  onTestEnd(test: TestCase, result: TestResult) {
    this.report.summary.total++;
    this.report.summary.duration += result.duration;

    const testInfo = {
      title: test.title,
      status: result.status,
      duration: Math.round(result.duration),
      error: result.error?.message,
    };

    if (result.status === 'passed') {
      this.report.summary.passed++;
    } else if (result.status === 'failed') {
      this.report.summary.failed++;
    } else {
      this.report.summary.skipped++;
    }

    this.report.tests.push(testInfo);
  }

  onEnd(result: FullResult) {
    const outputDir = join(process.cwd(), 'test-outputs');
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    const reportPath = join(outputDir, 'browser-test-report.json');
    writeFileSync(reportPath, JSON.stringify(this.report, null, 2));

    console.log('\n' + '='.repeat(60));
    console.log('📊 Test Summary');
    console.log('='.repeat(60));
    console.log(`Total: ${this.report.summary.total}`);
    console.log(`✓ Passed: ${this.report.summary.passed}`);
    console.log(`✗ Failed: ${this.report.summary.failed}`);
    console.log(`⊘ Skipped: ${this.report.summary.skipped}`);
    console.log(`Duration: ${(this.report.summary.duration / 1000).toFixed(2)}s`);
    console.log('='.repeat(60));
    console.log(`\n📄 Detailed report saved to: ${reportPath}\n`);

    if (this.report.summary.failed > 0) {
      console.log('Failed Tests:');
      this.report.tests
        .filter(t => t.status === 'failed')
        .forEach(test => {
          console.log(`  ✗ ${test.title}`);
          if (test.error) {
            console.log(`    Error: ${test.error}`);
          }
        });
    }
  }
}


