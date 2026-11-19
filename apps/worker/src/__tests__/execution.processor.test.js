import { describe, it, expect, vi } from "vitest";
import { processExecutionJob } from "../processors/execution.processor.js";
import { MockExecutionProvider } from "../providers/mock.provider.js";
import { Submission } from "../models/submission.model.js";
import { EXECUTION_STATUS, SUBMISSION_LIFECYCLE } from "@platform/shared";

describe("Worker Execution Processor", () => {
  it("processes successful execution job and publishes completion event", async () => {
    const mockFindByIdAndUpdate = vi.spyOn(Submission, "findByIdAndUpdate").mockResolvedValue({});
    const mockPublisher = {
      publish: vi.fn().mockResolvedValue(1),
    };

    const mockJob = {
      id: "job_123",
      data: {
        submissionId: "673f8a000000000000000001",
        interviewId: "673f8a000000000000000002",
        questionId: "673f8a000000000000000003",
        language: "javascript",
        sourceCode: "function twoSum() { return [0, 1]; }",
        submissionType: "submit",
        testCases: [
          { testIndex: 1, input: "test", expectedOutput: "[0,1]", visibility: "public" },
        ],
      },
    };

    const provider = new MockExecutionProvider();
    const result = await processExecutionJob(mockJob, {
      provider,
      publisher: mockPublisher,
    });

    expect(result.status).toBe(SUBMISSION_LIFECYCLE.COMPLETED);
    expect(result.executionResult.status).toBe(EXECUTION_STATUS.PASSED);
    expect(result.executionResult.passedCount).toBe(1);

    expect(mockFindByIdAndUpdate).toHaveBeenCalled();
    expect(mockPublisher.publish).toHaveBeenCalledWith(
      "submission:events",
      expect.stringContaining("submission:completed"),
    );
  });

  it("handles provider failure gracefully, records failed status and system_error", async () => {
    vi.spyOn(Submission, "findByIdAndUpdate").mockResolvedValue({});
    const mockPublisher = {
      publish: vi.fn().mockResolvedValue(1),
    };

    const mockJob = {
      id: "job_err",
      data: {
        submissionId: "673f8a000000000000000001",
        interviewId: "673f8a000000000000000002",
        questionId: "673f8a000000000000000003",
        language: "javascript",
        sourceCode: "console.log('test')",
        submissionType: "run",
        testCases: [{ testIndex: 1, input: "1", expectedOutput: "1", visibility: "public" }],
      },
    };

    const provider = new MockExecutionProvider({ shouldFailSystem: true });
    const result = await processExecutionJob(mockJob, {
      provider,
      publisher: mockPublisher,
    });

    expect(result.status).toBe(SUBMISSION_LIFECYCLE.FAILED);
    expect(result.executionResult.status).toBe(EXECUTION_STATUS.SYSTEM_ERROR);
    expect(result.executionResult.errorMessage).toContain("Judge0 instance is unreachable");

    expect(mockPublisher.publish).toHaveBeenCalledWith(
      "submission:events",
      expect.stringContaining("submission:failed"),
    );
  });
});
