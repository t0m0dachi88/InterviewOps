import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { InterviewHeader } from "../features/interview-room/components/InterviewHeader";
import { QuestionPanel } from "../features/interview-room/components/QuestionPanel";
import { SubmissionPanel } from "../features/submissions/components/SubmissionPanel";
import { CandidateJoinPage } from "../pages/CandidateJoinPage";
import * as apiClient from "../lib/api-client";

describe("Frontend Interview Room & Workspaces", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders InterviewHeader with connection status, participant counts, and duration", () => {
    render(
      <MemoryRouter>
        <InterviewHeader
          title="Senior Systems Engineer Interview"
          organizationName="Acme Labs"
          status="in_progress"
          durationMinutes={60}
          isConnected={true}
          isReconnecting={false}
          participantCount={2}
          isInterviewer={true}
          participantName="Lead Interviewer"
        />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Senior Systems Engineer Interview/i)).toBeInTheDocument();
    expect(screen.getByText(/Acme Labs/i)).toBeInTheDocument();
    expect(screen.getByText(/In Progress/i)).toBeInTheDocument();
    expect(screen.getByText(/2 people online/i)).toBeInTheDocument();
    expect(screen.getByText(/Connected/i)).toBeInTheDocument();
    expect(screen.getByText(/Lead Interviewer/i)).toBeInTheDocument();
  });

  it("renders QuestionPanel with immutable snapshot data, examples, and constraints", () => {
    const mockQuestions: apiClient.QuestionSnapshotDto[] = [
      {
        questionId: "q1",
        version: 1,
        title: "Two Sum Problem",
        statement: "Given an array of integers, return indices of the two numbers that add up to target.",
        constraints: ["2 <= nums.length <= 10^4", "-10^9 <= nums[i] <= 10^9"],
        examples: [
          {
            input: "nums = [2,7,11,15], target = 9",
            output: "[0,1]",
            explanation: "Because nums[0] + nums[1] == 9, we return [0, 1].",
          },
        ],
        timeAllocationMinutes: 25,
      },
    ];

    render(
      <QuestionPanel
        questions={mockQuestions}
        activeQuestionId="q1"
        onSelectQuestion={vi.fn()}
        canNavigate={true}
      />,
    );

    expect(screen.getByText(/Two Sum Problem/i)).toBeInTheDocument();
    expect(screen.getByText(/Given an array of integers/i)).toBeInTheDocument();
    expect(screen.getByText(/2 <= nums.length <= 10\^4/i)).toBeInTheDocument();
    expect(screen.getByText(/Example 1/i)).toBeInTheDocument();
    expect(screen.getByText(/nums = \[2,7,11,15\], target = 9/i)).toBeInTheDocument();
    expect(screen.getByText(/\[0,1\]/i)).toBeInTheDocument();
    expect(screen.getByText(/Immutable Assessment Snapshot/i)).toBeInTheDocument();
  });

  it("renders SubmissionPanel with test runner and submission history", () => {
    const mockSubmissions: apiClient.SubmissionDto[] = [
      {
        id: "sub_1",
        organizationId: "org_1",
        interviewId: "int_1",
        questionId: "q_1",
        questionVersion: 1,
        candidateUserId: "cand_1",
        candidateName: "John Doe",
        candidateEmail: "john@example.com",
        language: "javascript",
        sourceCode: "console.log('first draft');",
        documentVersion: 1,
        submissionType: "run",
        status: "saved",
        sequenceNumber: 1,
        submittedBy: { id: "u_1", name: "John Doe", role: "candidate" },
        createdAt: new Date().toISOString(),
      },
      {
        id: "sub_2",
        organizationId: "org_1",
        interviewId: "int_1",
        questionId: "q_1",
        questionVersion: 1,
        candidateUserId: "cand_1",
        candidateName: "John Doe",
        candidateEmail: "john@example.com",
        language: "javascript",
        sourceCode: "console.log('final code');",
        documentVersion: 3,
        submissionType: "submit",
        status: "completed",
        sequenceNumber: 2,
        submittedBy: { id: "u_1", name: "John Doe", role: "candidate" },
        executionResult: {
          status: "passed",
          passedCount: 2,
          failedCount: 0,
          totalCount: 2,
          durationMs: 45,
          peakMemoryKb: 2048,
          compileOutput: "",
          stderr: "",
          stdout: "[0,1]",
          executedAt: new Date().toISOString(),
          testResults: [
            {
              testIndex: 1,
              visibility: "public",
              status: "passed",
              passed: true,
              input: "nums = [2,7], target = 9",
              expectedOutput: "[0,1]",
              actualOutput: "[0,1]",
              durationMs: 20,
              memoryKb: 1024,
            },
            {
              testIndex: 2,
              visibility: "hidden",
              status: "passed",
              passed: true,
              durationMs: 25,
            },
          ],
        },
        createdAt: new Date().toISOString(),
      },
    ];

    render(
      <SubmissionPanel
        submissions={mockSubmissions}
        onSave={vi.fn()}
        onRun={vi.fn()}
        onSubmit={vi.fn()}
        isSaving={false}
        isRunning={false}
        isSubmitting={false}
        currentExecution={mockSubmissions[1].executionResult}
        executionStatus="completed"
        executionType="submit"
        lastMessage="Execution completed on Judge0."
      />,
    );

    expect(screen.getByRole("button", { name: /Run Code/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Submit Solution/i })).toBeInTheDocument();
    expect(screen.getByText(/Execution completed on Judge0\./i)).toBeInTheDocument();
    expect(screen.getByText(/Accepted \(2\/2\)/i)).toBeInTheDocument();

    // Check hidden test mask
    fireEvent.click(screen.getByRole("button", { name: /Hidden #2/i }));
    expect(screen.getByText(/Hidden Assessment Test Case/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Input, expected output, and harness details are hidden to maintain assessment integrity\./i),
    ).toBeInTheDocument();

    // Switch to history tab
    fireEvent.click(screen.getByRole("button", { name: /History \(2\)/i }));
    expect(screen.getByText(/#1/i)).toBeInTheDocument();
    expect(screen.getByText(/#2/i)).toBeInTheDocument();
  });

  it("CandidateJoinPage validates invitation token and displays interview information", async () => {
    const mockInvitationData: apiClient.CandidateInvitationDto = {
      invitation: {
        id: "inv_123",
        candidateName: "Sarah Connor",
        candidateEmail: "sarah@resistance.org",
        status: "pending",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
      interview: {
        id: "int_999",
        title: "Full Stack Live Coding Session",
        description: "Technical interview covering algorithms and distributed systems.",
        interviewType: "technical",
        durationMinutes: 45,
        scheduledStartAt: new Date().toISOString(),
        scheduledEndAt: new Date(Date.now() + 2700000).toISOString(),
        timezone: "UTC",
        status: "scheduled",
      },
      organization: {
        id: "org_999",
        name: "Cyberdyne Systems",
      },
    };

    vi.spyOn(apiClient, "getCandidateInvitationApi").mockResolvedValueOnce(mockInvitationData);

    render(
      <MemoryRouter initialEntries={["/candidate/join/token-abc-123"]}>
        <Routes>
          <Route path="/candidate/join/:token" element={<CandidateJoinPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Cyberdyne Systems/i)).toBeInTheDocument();
      expect(screen.getByText(/Full Stack Live Coding Session/i)).toBeInTheDocument();
      expect(screen.getByText(/Sarah Connor/i)).toBeInTheDocument();
      expect(screen.getByText(/45 minutes/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Enter Live Interview/i })).toBeInTheDocument();
    });
  });
});
