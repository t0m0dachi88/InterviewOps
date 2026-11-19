import { EXECUTION_STATUS } from "@platform/shared";
import { ExecutionProvider } from "./execution-provider.interface.js";

const DEFAULT_LANGUAGE_IDS = Object.freeze({
  javascript: 63, // Node.js 12.14.0 or configured version
  python: 71,     // Python 3.8.1 or configured version
  cpp: 54,        // C++ (GCC 9.2.0) or configured version
});

const MAX_OUTPUT_BYTES = 65536; // 64 KB maximum output buffer

function encodeBase64(str) {
  if (typeof str !== "string") return "";
  return Buffer.from(str, "utf-8").toString("base64");
}

function decodeBase64(b64) {
  if (!b64 || typeof b64 !== "string") return "";
  try {
    const text = Buffer.from(b64, "base64").toString("utf-8");
    if (text.length > MAX_OUTPUT_BYTES) {
      return text.slice(0, MAX_OUTPUT_BYTES) + "\n... [Output truncated (exceeded 64 KB)]";
    }
    return text;
  } catch {
    return "";
  }
}

export class Judge0ExecutionProvider extends ExecutionProvider {
  /**
   * @param {object} config
   * @param {string} config.baseUrl - Judge0 API URL
   * @param {string} [config.apiKey] - Judge0 API Key / Auth Token
   * @param {Record<string, number>} [config.languageMap] - Custom language ID mapping
   */
  constructor(config = {}) {
    super();
    this.baseUrl = (config.baseUrl || "http://localhost:2358").replace(/\/+$/, "");
    this.apiKey = config.apiKey || "";
    this.languageMap = { ...DEFAULT_LANGUAGE_IDS, ...(config.languageMap || {}) };
  }

  _getHeaders() {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (this.apiKey) {
      headers["X-Auth-Token"] = this.apiKey;
      headers["X-Judge0-Token"] = this.apiKey;
    }
    return headers;
  }

  async ping() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`${this.baseUrl}/system_info`, {
        headers: this._getHeaders(),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Map Judge0 status ID to standard EXECUTION_STATUS
   *
   * @param {number} statusId
   * @returns {string}
   */
  _mapStatusId(statusId) {
    switch (statusId) {
      case 1: // In Queue
      case 2: // Processing
        return EXECUTION_STATUS.RUNNING;
      case 3: // Accepted
        return EXECUTION_STATUS.PASSED;
      case 4: // Wrong Answer
        return EXECUTION_STATUS.FAILED;
      case 5: // Time Limit Exceeded
        return EXECUTION_STATUS.TIME_LIMIT_EXCEEDED;
      case 6: // Compilation Error
        return EXECUTION_STATUS.COMPILE_ERROR;
      case 7:  // SIGSEGV
      case 8:  // SIGXFSZ
      case 9:  // SIGFPE
      case 10: // SIGABRT
      case 11: // NZEC
      case 12: // Other
        return EXECUTION_STATUS.RUNTIME_ERROR;
      case 13: // Internal Error
      case 14: // Exec Format Error
      default:
        return EXECUTION_STATUS.SYSTEM_ERROR;
    }
  }

  /**
   * Execute code against a single test case.
   */
  async _executeSingleTestCase({
    sourceCode,
    languageId,
    testCase,
    cpuTimeLimit,
    memoryLimitKb,
  }) {
    const payload = {
      source_code: encodeBase64(sourceCode),
      language_id: languageId,
      stdin: encodeBase64(testCase.input || ""),
      expected_output: encodeBase64(testCase.expectedOutput || ""),
      cpu_time_limit: cpuTimeLimit,
      memory_limit: memoryLimitKb,
      wall_time_limit: Math.max(cpuTimeLimit * 2, 5),
    };

    const controller = new AbortController();
    const timeoutMs = (payload.wall_time_limit + 5) * 1000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let res;
    try {
      res = await fetch(`${this.baseUrl}/submissions?base64_encoded=true&wait=true`, {
        method: "POST",
        headers: this._getHeaders(),
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      throw new Error(`Judge0 connection failed: ${err.message}`);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Judge0 returned HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json();
    let result = data;

    // If Judge0 returned without completing, poll briefly
    if (result.status && (result.status.id === 1 || result.status.id === 2)) {
      const token = result.token;
      let attempts = 0;
      while (attempts < 15 && (result.status.id === 1 || result.status.id === 2)) {
        await new Promise((r) => setTimeout(r, 600));
        const pollRes = await fetch(`${this.baseUrl}/submissions/${token}?base64_encoded=true`, {
          headers: this._getHeaders(),
        });
        if (pollRes.ok) {
          result = await pollRes.json();
        }
        attempts++;
      }
    }

    const statusId = result.status?.id || 13;
    const stdout = decodeBase64(result.stdout);
    const stderr = decodeBase64(result.stderr);
    const compileOutput = decodeBase64(result.compile_output);
    const durationMs = result.time ? Math.round(parseFloat(result.time) * 1000) : 0;
    const memoryKb = result.memory ? parseInt(result.memory, 10) : 0;

    const mappedStatus = this._mapStatusId(statusId);

    // Verify output match
    let passed = mappedStatus === EXECUTION_STATUS.PASSED;
    if (passed && testCase.expectedOutput !== undefined) {
      passed = stdout.trim() === String(testCase.expectedOutput).trim();
    }

    return {
      testIndex: testCase.testIndex,
      visibility: testCase.visibility || "public",
      status: passed ? EXECUTION_STATUS.PASSED : mappedStatus,
      passed,
      input: testCase.input,
      expectedOutput: testCase.expectedOutput,
      actualOutput: stdout,
      compileOutput,
      stderr,
      durationMs,
      memoryKb,
    };
  }

  async execute({
    sourceCode,
    language,
    testCases = [],
    timeLimitMs = 2000,
    memoryLimitMb = 256,
  }) {
    const languageId = this.languageMap[language];
    if (!languageId) {
      throw new Error(`Language '${language}' is not supported by Judge0 provider.`);
    }

    const cpuTimeLimit = Math.max(1, Math.min(Math.round(timeLimitMs / 1000), 10)); // 1s - 10s
    const memoryLimitKb = Math.max(16384, Math.min(memoryLimitMb * 1024, 524288)); // 16MB - 512MB

    const testResults = [];
    let passedCount = 0;
    let failedCount = 0;
    let peakMemoryKb = 0;
    let totalDurationMs = 0;
    let fatalCompileOutput = "";
    let overallStatus = EXECUTION_STATUS.PASSED;

    for (let i = 0; i < testCases.length; i++) {
      const tc = {
        testIndex: testCases[i].testIndex !== undefined ? testCases[i].testIndex : i + 1,
        input: testCases[i].input || "",
        expectedOutput: testCases[i].expectedOutput || "",
        visibility: testCases[i].visibility || "public",
      };

      const singleResult = await this._executeSingleTestCase({
        sourceCode,
        languageId,
        testCase: tc,
        cpuTimeLimit,
        memoryLimitKb,
      });

      testResults.push(singleResult);
      totalDurationMs += singleResult.durationMs;
      if (singleResult.memoryKb > peakMemoryKb) {
        peakMemoryKb = singleResult.memoryKb;
      }

      if (singleResult.passed) {
        passedCount++;
      } else {
        failedCount++;
        // If compilation error, capture error and stop running subsequent test cases
        if (singleResult.status === EXECUTION_STATUS.COMPILE_ERROR) {
          fatalCompileOutput = singleResult.compileOutput;
          overallStatus = EXECUTION_STATUS.COMPILE_ERROR;
          break;
        } else if (overallStatus === EXECUTION_STATUS.PASSED) {
          overallStatus = singleResult.status;
        }
      }
    }

    if (overallStatus !== EXECUTION_STATUS.COMPILE_ERROR && failedCount > 0) {
      overallStatus = EXECUTION_STATUS.FAILED;
    }

    return {
      status: overallStatus,
      passedCount,
      failedCount,
      totalCount: testCases.length,
      durationMs: totalDurationMs,
      peakMemoryKb,
      compileOutput: fatalCompileOutput || testResults[0]?.compileOutput || "",
      stderr: testResults.map((r) => r.stderr).filter(Boolean).join("\n"),
      stdout: testResults[0]?.actualOutput || "",
      testResults,
    };
  }
}
