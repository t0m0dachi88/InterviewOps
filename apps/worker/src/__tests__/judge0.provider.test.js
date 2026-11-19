import { describe, it, expect, vi, beforeEach } from "vitest";
import { Judge0ExecutionProvider } from "../providers/judge0.provider.js";
import { MockExecutionProvider } from "../providers/mock.provider.js";
import { EXECUTION_STATUS } from "@platform/shared";

describe("Execution Provider Abstraction & Judge0 Integration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("MockExecutionProvider", () => {
    it("reports healthy ping", async () => {
      const mock = new MockExecutionProvider();
      expect(await mock.ping()).toBe(true);
    });

    it("evaluates passing test cases", async () => {
      const mock = new MockExecutionProvider();
      const res = await mock.execute({
        sourceCode: "function twoSum() { return [0, 1]; }",
        language: "javascript",
        testCases: [
          { testIndex: 1, input: "nums = [2,7], target = 9", expectedOutput: "[0,1]", visibility: "public" },
          { testIndex: 2, input: "nums = [3,2,4], target = 6", expectedOutput: "[1,2]", visibility: "hidden" },
        ],
      });

      expect(res.status).toBe(EXECUTION_STATUS.PASSED);
      expect(res.passedCount).toBe(2);
      expect(res.failedCount).toBe(0);
      expect(res.totalCount).toBe(2);
      expect(res.testResults[0].passed).toBe(true);
      expect(res.testResults[1].passed).toBe(true);
    });

    it("evaluates failing test cases when WRONG_ANSWER marker is present", async () => {
      const mock = new MockExecutionProvider();
      const res = await mock.execute({
        sourceCode: "function solution() { return WRONG_ANSWER; }",
        language: "javascript",
        testCases: [
          { testIndex: 1, input: "test", expectedOutput: "correct", visibility: "public" },
        ],
      });

      expect(res.status).toBe(EXECUTION_STATUS.FAILED);
      expect(res.passedCount).toBe(0);
      expect(res.failedCount).toBe(1);
      expect(res.testResults[0].passed).toBe(false);
    });

    it("simulates compilation error when SYNTAX_ERROR is present", async () => {
      const mock = new MockExecutionProvider();
      const res = await mock.execute({
        sourceCode: "SYNTAX_ERROR let x = ;",
        language: "javascript",
        testCases: [{ testIndex: 1, input: "1", expectedOutput: "1", visibility: "public" }],
      });

      expect(res.status).toBe(EXECUTION_STATUS.COMPILE_ERROR);
      expect(res.compileOutput).toContain("expected ';'");
      expect(res.testResults[0].passed).toBe(false);
    });

    it("simulates time limit exceeded when INFINITE_LOOP is present", async () => {
      const mock = new MockExecutionProvider();
      const res = await mock.execute({
        sourceCode: "while(true) { INFINITE_LOOP }",
        language: "javascript",
        testCases: [{ testIndex: 1, input: "1", expectedOutput: "1", visibility: "public" }],
      });

      expect(res.status).toBe(EXECUTION_STATUS.TIME_LIMIT_EXCEEDED);
      expect(res.durationMs).toBeGreaterThan(2000);
    });

    it("simulates runtime error when RUNTIME_ERROR is present", async () => {
      const mock = new MockExecutionProvider();
      const res = await mock.execute({
        sourceCode: "RUNTIME_ERROR null.foo()",
        language: "javascript",
        testCases: [{ testIndex: 1, input: "1", expectedOutput: "1", visibility: "public" }],
      });

      expect(res.status).toBe(EXECUTION_STATUS.RUNTIME_ERROR);
      expect(res.stderr).toContain("ReferenceError");
    });

    it("throws error when simulated Judge0 service is down", async () => {
      const mock = new MockExecutionProvider({ shouldFailSystem: true });
      expect(await mock.ping()).toBe(false);
      await expect(
        mock.execute({
          sourceCode: "console.log('hello')",
          language: "javascript",
          testCases: [],
        }),
      ).rejects.toThrow(/unreachable/i);
    });
  });

  describe("Judge0ExecutionProvider", () => {
    it("formats base64 payloads and parses successful Judge0 execution response", async () => {
      const provider = new Judge0ExecutionProvider({
        baseUrl: "http://mock-judge0:2358",
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: { id: 3, description: "Accepted" },
          stdout: Buffer.from("42\n").toString("base64"),
          stderr: "",
          compile_output: "",
          time: "0.015",
          memory: 2048,
        }),
      });
      global.fetch = mockFetch;

      const res = await provider.execute({
        sourceCode: "console.log(42)",
        language: "javascript",
        testCases: [
          { testIndex: 1, input: "test-in", expectedOutput: "42", visibility: "public" },
        ],
      });

      expect(mockFetch).toHaveBeenCalled();
      expect(res.status).toBe(EXECUTION_STATUS.PASSED);
      expect(res.passedCount).toBe(1);
      expect(res.testResults[0].actualOutput).toBe("42\n");
      expect(res.durationMs).toBe(15);
    });

    it("maps Judge0 status 6 to COMPILE_ERROR and halts further test runs", async () => {
      const provider = new Judge0ExecutionProvider({
        baseUrl: "http://mock-judge0:2358",
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: { id: 6, description: "Compilation Error" },
          stdout: "",
          stderr: "",
          compile_output: Buffer.from("error: expected ';'\n").toString("base64"),
          time: "0.005",
          memory: 1024,
        }),
      });
      global.fetch = mockFetch;

      const res = await provider.execute({
        sourceCode: "syntax error",
        language: "cpp",
        testCases: [
          { testIndex: 1, input: "1", expectedOutput: "1", visibility: "public" },
          { testIndex: 2, input: "2", expectedOutput: "2", visibility: "hidden" },
        ],
      });

      // Should stop after test 1 fails with compilation error
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(EXECUTION_STATUS.COMPILE_ERROR);
      expect(res.compileOutput).toContain("expected ';'");
    });

    it("truncates oversized output to prevent buffer flooding", async () => {
      const provider = new Judge0ExecutionProvider({
        baseUrl: "http://mock-judge0:2358",
      });

      const hugeOutput = "A".repeat(80000); // 80 KB
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: { id: 3, description: "Accepted" },
          stdout: Buffer.from(hugeOutput).toString("base64"),
          stderr: "",
          compile_output: "",
          time: "0.05",
          memory: 4096,
        }),
      });
      global.fetch = mockFetch;

      const res = await provider.execute({
        sourceCode: "console.log('infinite')",
        language: "javascript",
        testCases: [{ testIndex: 1, input: "", expectedOutput: "expected", visibility: "public" }],
      });

      expect(res.testResults[0].actualOutput).toContain("[Output truncated (exceeded 64 KB)]");
    });
  });
});
