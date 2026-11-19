/**
 * Abstract Execution Provider interface.
 * Decouples the application and worker from Judge0 or any specific execution backend.
 */
export class ExecutionProvider {
  /**
   * Execute code against a series of test cases.
   *
   * @param {object} params
   * @param {string} params.sourceCode - The full code to execute
   * @param {string} params.language - Language ('javascript' | 'python' | 'cpp')
   * @param {Array<{ testIndex: number, input: string, expectedOutput: string, visibility: string }>} params.testCases
   * @param {number} [params.timeLimitMs] - CPU time limit in milliseconds
   * @param {number} [params.memoryLimitMb] - Memory limit in megabytes
   * @returns {Promise<import('./types.js').NormalizedExecutionResult>}
   */
  async execute({
    sourceCode: _sourceCode,
    language: _language,
    testCases: _testCases,
    timeLimitMs: _timeLimitMs = 2000,
    memoryLimitMb: _memoryLimitMb = 256,
  }) {
    throw new Error("ExecutionProvider.execute() must be implemented by subclass");
  }

  /**
   * Check health and availability of the execution backend.
   *
   * @returns {Promise<boolean>}
   */
  async ping() {
    throw new Error("ExecutionProvider.ping() must be implemented by subclass");
  }
}
