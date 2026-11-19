import { EXECUTION_STATUS } from "@platform/shared";
import { ExecutionProvider } from "./execution-provider.interface.js";

export class MockExecutionProvider extends ExecutionProvider {
  /**
   * @param {object} [options]
   * @param {boolean} [options.shouldFailSystem] - If true, throws system error (simulates Judge0 down)
   * @param {string} [options.forceStatus] - Force an overall status (e.g., COMPILE_ERROR, TIME_LIMIT_EXCEEDED)
   */
  constructor(options = {}) {
    super();
    this.shouldFailSystem = options.shouldFailSystem || false;
    this.forceStatus = options.forceStatus || null;
  }

  async ping() {
    return !this.shouldFailSystem;
  }

  async execute({
    sourceCode = "",
    language: _language = "javascript",
    testCases = [],
    timeLimitMs: _timeLimitMs = 2000,
    memoryLimitMb: _memoryLimitMb = 256,
  }) {
    if (this.shouldFailSystem) {
      throw new Error("Mock Judge0 instance is unreachable (simulated connection refusal)");
    }

    if (this.forceStatus === EXECUTION_STATUS.COMPILE_ERROR || sourceCode.includes("SYNTAX_ERROR")) {
      return {
        status: EXECUTION_STATUS.COMPILE_ERROR,
        passedCount: 0,
        failedCount: testCases.length,
        totalCount: testCases.length,
        durationMs: 45,
        peakMemoryKb: 2048,
        compileOutput: "error: expected ';' before 'return'\n   | return 42\n   | ^",
        stderr: "",
        stdout: "",
        testResults: [
          {
            testIndex: 1,
            visibility: testCases[0]?.visibility || "public",
            status: EXECUTION_STATUS.COMPILE_ERROR,
            passed: false,
            input: testCases[0]?.input || "",
            expectedOutput: testCases[0]?.expectedOutput || "",
            actualOutput: "",
            compileOutput: "error: expected ';' before 'return'",
            stderr: "",
            durationMs: 45,
            memoryKb: 2048,
          },
        ],
      };
    }

    if (this.forceStatus === EXECUTION_STATUS.TIME_LIMIT_EXCEEDED || sourceCode.includes("INFINITE_LOOP")) {
      return {
        status: EXECUTION_STATUS.TIME_LIMIT_EXCEEDED,
        passedCount: 0,
        failedCount: testCases.length,
        totalCount: testCases.length,
        durationMs: 2005,
        peakMemoryKb: 8192,
        compileOutput: "",
        stderr: "Time limit exceeded (2.0s exceeded)",
        stdout: "",
        testResults: testCases.map((tc, idx) => ({
          testIndex: tc.testIndex || idx + 1,
          visibility: tc.visibility || "public",
          status: EXECUTION_STATUS.TIME_LIMIT_EXCEEDED,
          passed: false,
          input: tc.input,
          expectedOutput: tc.expectedOutput,
          actualOutput: "",
          compileOutput: "",
          stderr: "Time limit exceeded",
          durationMs: 2005,
          memoryKb: 8192,
        })),
      };
    }

    if (this.forceStatus === EXECUTION_STATUS.RUNTIME_ERROR || sourceCode.includes("RUNTIME_ERROR")) {
      return {
        status: EXECUTION_STATUS.RUNTIME_ERROR,
        passedCount: 0,
        failedCount: testCases.length,
        totalCount: testCases.length,
        durationMs: 80,
        peakMemoryKb: 4096,
        compileOutput: "",
        stderr: "ReferenceError: solution is not defined\n    at evalmachine.<anonymous>:3:1",
        stdout: "",
        testResults: testCases.map((tc, idx) => ({
          testIndex: tc.testIndex || idx + 1,
          visibility: tc.visibility || "public",
          status: EXECUTION_STATUS.RUNTIME_ERROR,
          passed: false,
          input: tc.input,
          expectedOutput: tc.expectedOutput,
          actualOutput: "",
          compileOutput: "",
          stderr: "ReferenceError: solution is not defined",
          durationMs: 80,
          memoryKb: 4096,
        })),
      };
    }

    // Default simulation: check if code contains WRONG_ANSWER
    const shouldFailTests = sourceCode.includes("WRONG_ANSWER");

    const testResults = testCases.map((tc, idx) => {
      const passed = !shouldFailTests;
      const actualOutput = passed
        ? tc.expectedOutput
        : "wrong_output_mock";

      return {
        testIndex: tc.testIndex || idx + 1,
        visibility: tc.visibility || "public",
        status: passed ? EXECUTION_STATUS.PASSED : EXECUTION_STATUS.FAILED,
        passed,
        input: tc.input,
        expectedOutput: tc.expectedOutput,
        actualOutput,
        compileOutput: "",
        stderr: "",
        durationMs: 15 + idx * 5,
        memoryKb: 3000 + idx * 100,
      };
    });

    const passedCount = testResults.filter((r) => r.passed).length;
    const failedCount = testResults.length - passedCount;
    const overallStatus = failedCount === 0 ? EXECUTION_STATUS.PASSED : EXECUTION_STATUS.FAILED;

    return {
      status: overallStatus,
      passedCount,
      failedCount,
      totalCount: testCases.length,
      durationMs: testResults.reduce((sum, r) => sum + r.durationMs, 0),
      peakMemoryKb: Math.max(...testResults.map((r) => r.memoryKb), 3000),
      compileOutput: "",
      stderr: "",
      stdout: testResults[0]?.actualOutput || "",
      testResults,
    };
  }
}
