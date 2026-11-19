import type { ApiResponseEnvelope, ApiSuccessEnvelope } from "@platform/shared";

const API_BASE_URL =
  import.meta.env.VITE_API_URL || "http://localhost:5000/api/v1";

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  emailVerifiedAt?: string | null;
  status: string;
}

export interface OrganizationSettings {
  defaultInterviewDurationMinutes: number;
  recordingEnabled: boolean;
  allowedLanguages: string[];
  dataRetentionDays: number;
}

export interface OrganizationItem {
  id: string;
  name: string;
  slug: string;
  ownerUserId: string;
  status: string;
  role?: "owner" | "admin" | "interviewer";
  settings: OrganizationSettings;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationMember {
  id: string;
  organizationId: string;
  userId: string;
  role: "owner" | "admin" | "interviewer";
  status: string;
  invitedBy?: string | null;
  user?: {
    id: string;
    email: string;
    displayName: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationInvitationItem {
  id: string;
  organizationId: string;
  email: string;
  invitedRole: "admin" | "interviewer";
  status: "pending" | "accepted" | "revoked" | "expired";
  invitedBy: string;
  expiresAt: string;
  acceptedAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
}

export interface HealthLivenessData {
  status: string;
  service: string;
  version: string;
  uptimeSeconds: number;
  timestamp: string;
}

export interface HealthReadinessData {
  isReady: boolean;
  status: "ready" | "degraded";
  service: string;
  version: string;
  timestamp: string;
  dependencies: {
    database: {
      type: string;
      status: string;
      connected: boolean;
    };
    redis: {
      type: string;
      status: string;
      connected: boolean;
      latencyMs?: number;
      error?: string;
    };
  };
}

export class ApiError extends Error {
  code: string;
  statusCode: number;
  details?: Record<string, any>;
  requestId?: string;

  constructor(
    message: string,
    code: string,
    statusCode: number,
    details?: Record<string, any>,
    requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.requestId = requestId;
  }
}

let inMemoryAccessToken: string | null = null;
let inMemoryCsrfToken: string | null = null;

export function setAccessToken(token: string | null) {
  inMemoryAccessToken = token;
}

export function getAccessToken(): string | null {
  return inMemoryAccessToken;
}

export function setCsrfToken(token: string | null) {
  inMemoryCsrfToken = token;
}

export function getCsrfToken(): string | null {
  if (inMemoryCsrfToken) return inMemoryCsrfToken;
  // Fallback to document.cookie if running in browser
  if (typeof document !== "undefined") {
    const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
    if (match) {
      return decodeURIComponent(match[1]);
    }
  }
  return null;
}

/**
 * Fetch wrapper for standardized platform API requests.
 */
export async function fetchApi<T = any>(
  endpoint: string,
  options: RequestInit = {},
): Promise<ApiSuccessEnvelope<T>> {
  const url = `${API_BASE_URL.replace(/\/+$/, "")}/${endpoint.replace(/^\/+/, "")}`;

  const headers = new Headers(options.headers || {});
  if (
    !headers.has("Content-Type") &&
    options.body &&
    typeof options.body === "string"
  ) {
    headers.set("Content-Type", "application/json");
  }

  // Inject Bearer access token if present
  if (inMemoryAccessToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${inMemoryAccessToken}`);
  }

  // Inject CSRF token for mutating requests
  const csrf = getCsrfToken();
  if (
    csrf &&
    !headers.has("X-CSRF-Token") &&
    options.method &&
    !["GET", "HEAD", "OPTIONS"].includes(options.method.toUpperCase())
  ) {
    headers.set("X-CSRF-Token", csrf);
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      credentials: options.credentials || "include",
    });

    let data: any;
    try {
      data = await response.json();
    } catch {
      throw new ApiError(
        `Server returned non-JSON response with HTTP status ${response.status}`,
        "HTTP_ERROR",
        response.status,
      );
    }

    if (!response.ok) {
      const errorObj = data?.error;
      throw new ApiError(
        errorObj?.message ||
          data?.message ||
          `API request failed with status ${response.status}`,
        errorObj?.code || "HTTP_ERROR",
        response.status,
        errorObj?.details,
        errorObj?.requestId,
      );
    }

    return data as ApiSuccessEnvelope<T>;
  } catch (err: any) {
    if (err instanceof ApiError) {
      throw err;
    }
    throw new ApiError(
      err.message || "Network error occurred while communicating with API",
      "NETWORK_ERROR",
      0,
    );
  }
}

// Health checks
export async function getHealth(): Promise<HealthLivenessData> {
  const res = await fetchApi<HealthLivenessData>("/health");
  return res.data;
}

export async function getReadiness(): Promise<HealthReadinessData> {
  const url = `${API_BASE_URL.replace(/\/+$/, "")}/health/ready`;
  const response = await fetch(url, { credentials: "omit" });
  const json: ApiResponseEnvelope<HealthReadinessData> = await response.json();

  if (json.success) {
    return json.data;
  }

  return {
    isReady: false,
    status: "degraded",
    service: "@platform/api",
    version: "0.1.0",
    timestamp: new Date().toISOString(),
    dependencies: (json as any).error?.details || {
      database: { type: "mongodb-atlas", status: "unknown", connected: false },
      redis: { type: "redis", status: "unknown", connected: false },
    },
  };
}

// Auth API
export async function registerApi(payload: {
  name: string;
  email: string;
  password: string;
}): Promise<{ user: UserProfile; accessToken: string; expiresIn: number }> {
  const res = await fetchApi<{
    user: UserProfile;
    accessToken: string;
    expiresIn: number;
  }>("/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  setAccessToken(res.data.accessToken);
  return res.data;
}

export async function loginApi(payload: {
  email: string;
  password: string;
}): Promise<{ user: UserProfile; accessToken: string; expiresIn: number }> {
  const res = await fetchApi<{
    user: UserProfile;
    accessToken: string;
    expiresIn: number;
  }>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  setAccessToken(res.data.accessToken);
  return res.data;
}

export async function refreshApi(): Promise<{
  user: UserProfile;
  accessToken: string;
  expiresIn: number;
}> {
  const res = await fetchApi<{
    user: UserProfile;
    accessToken: string;
    expiresIn: number;
  }>("/auth/refresh", {
    method: "POST",
  });
  setAccessToken(res.data.accessToken);
  return res.data;
}

export async function logoutApi(): Promise<{ loggedOut: boolean }> {
  try {
    const res = await fetchApi<{ loggedOut: boolean }>("/auth/logout", {
      method: "POST",
    });
    return res.data;
  } finally {
    setAccessToken(null);
  }
}

export async function getMeApi(): Promise<{
  user: UserProfile;
  csrfToken?: string;
}> {
  const res = await fetchApi<{ user: UserProfile; csrfToken?: string }>(
    "/auth/me",
  );
  if (res.data.csrfToken) {
    setCsrfToken(res.data.csrfToken);
  }
  return res.data;
}

// Organization API
export async function listOrganizationsApi(): Promise<OrganizationItem[]> {
  const res = await fetchApi<{ organizations: OrganizationItem[] }>(
    "/organizations",
  );
  return res.data.organizations;
}

export async function createOrganizationApi(payload: {
  name: string;
  slug?: string;
}): Promise<OrganizationItem> {
  const res = await fetchApi<{ organization: OrganizationItem }>(
    "/organizations",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
  return res.data.organization;
}

export async function getOrganizationApi(
  organizationId: string,
): Promise<OrganizationItem> {
  const res = await fetchApi<{ organization: OrganizationItem }>(
    `/organizations/${organizationId}`,
  );
  return res.data.organization;
}

export async function updateOrganizationApi(
  organizationId: string,
  payload: { name?: string; settings?: Partial<OrganizationSettings> },
): Promise<OrganizationItem> {
  const res = await fetchApi<{ organization: OrganizationItem }>(
    `/organizations/${organizationId}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
  return res.data.organization;
}

// Member API
export async function listMembersApi(
  organizationId: string,
): Promise<OrganizationMember[]> {
  const res = await fetchApi<{ members: OrganizationMember[] }>(
    `/organizations/${organizationId}/members`,
  );
  return res.data.members;
}

export async function updateMemberRoleApi(
  organizationId: string,
  membershipId: string,
  role: "admin" | "interviewer",
): Promise<OrganizationMember> {
  const res = await fetchApi<{ membership: OrganizationMember }>(
    `/organizations/${organizationId}/members/${membershipId}`,
    {
      method: "PATCH",
      body: JSON.stringify({ role }),
    },
  );
  return res.data.membership;
}

export async function removeMemberApi(
  organizationId: string,
  membershipId: string,
): Promise<{ removed: boolean; membershipId: string }> {
  const res = await fetchApi<{ removed: boolean; membershipId: string }>(
    `/organizations/${organizationId}/members/${membershipId}`,
    {
      method: "DELETE",
    },
  );
  return res.data;
}

export async function transferOwnershipApi(
  organizationId: string,
  membershipId: string,
): Promise<{ membership: OrganizationMember }> {
  const res = await fetchApi<{ membership: OrganizationMember }>(
    `/organizations/${organizationId}/transfer-ownership`,
    {
      method: "POST",
      body: JSON.stringify({ membershipId }),
    },
  );
  return res.data;
}

// Invitation API
export async function listInvitationsApi(
  organizationId: string,
): Promise<OrganizationInvitationItem[]> {
  const res = await fetchApi<{ invitations: OrganizationInvitationItem[] }>(
    `/organizations/${organizationId}/invitations`,
  );
  return res.data.invitations;
}

export async function createInvitationApi(
  organizationId: string,
  payload: { email: string; role: "admin" | "interviewer" },
): Promise<{
  invitation: OrganizationInvitationItem;
  email: { delivered: boolean; reason: string | null };
  debugToken?: string;
}> {
  const res = await fetchApi<{
    invitation: OrganizationInvitationItem;
    email: { delivered: boolean; reason: string | null };
    debugToken?: string;
  }>(`/organizations/${organizationId}/invitations`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function revokeInvitationApi(
  organizationId: string,
  invitationId: string,
): Promise<{ invitation: OrganizationInvitationItem }> {
  const res = await fetchApi<{ invitation: OrganizationInvitationItem }>(
    `/organizations/${organizationId}/invitations/${invitationId}`,
    {
      method: "DELETE",
    },
  );
  return res.data;
}

export async function acceptInvitationApi(token: string): Promise<{
  membership: OrganizationMember;
  organizationId: string;
  organizationName?: string;
  alreadyMember: boolean;
}> {
  const res = await fetchApi<{
    membership: OrganizationMember;
    organizationId: string;
    organizationName?: string;
    alreadyMember: boolean;
  }>("/invitations/accept", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
  return res.data;
}

// ---------------------------------------------------------------------------
// Phase 3 — Live Interview Environment Types & APIs
// ---------------------------------------------------------------------------

export interface QuestionSnapshotDto {
  questionId: string;
  version: number;
  title: string;
  statement: string;
  constraints?: string[];
  examples?: Array<{ input: string; output: string; explanation?: string }>;
  allowedLanguages?: string[];
  starterCodeByLanguage?: Record<string, string>;
  publicTests?: Array<{ input: string; expectedOutput: string }>;
  timeLimitMs?: number;
  memoryLimitMb?: number;
  order?: number;
  timeAllocationMinutes?: number;
}

export interface ParticipantDto {
  id: string;
  name: string;
  role: string;
  isCandidate: boolean;
  joinedAt?: string;
  connectionCount?: number;
}

export interface InterviewRoomData {
  interview: {
    id: string;
    title: string;
    description: string;
    interviewType: string;
    status: string;
    durationMinutes: number;
    scheduledStartAt: string | null;
    scheduledEndAt: string | null;
    startedAt: string | null;
    endedAt: string | null;
    timezone: string;
    organizationId: string;
    organizationName: string;
    candidate: {
      name: string;
      email: string;
    };
  };
  participant: ParticipantDto;
  activeQuestionId: string | null;
  questions: QuestionSnapshotDto[];
  participants: ParticipantDto[];
  permissions: {
    canEdit: boolean;
    canNavigateQuestions: boolean;
    canEndInterview: boolean;
    isInterviewer: boolean;
  };
}

export interface TestCaseResultDto {
  testIndex: number;
  visibility: "public" | "hidden";
  status: string;
  passed: boolean;
  input?: string;
  expectedOutput?: string;
  actualOutput?: string;
  compileOutput?: string;
  stderr?: string;
  durationMs?: number;
  memoryKb?: number;
}

export interface ExecutionResultDto {
  status:
    | "queued"
    | "running"
    | "passed"
    | "failed"
    | "compile_error"
    | "runtime_error"
    | "time_limit_exceeded"
    | "memory_limit_exceeded"
    | "system_error";
  passedCount: number;
  failedCount: number;
  totalCount: number;
  durationMs: number;
  peakMemoryKb: number;
  compileOutput: string;
  stderr: string;
  stdout: string;
  errorMessage?: string;
  executedAt: string | null;
  testResults: TestCaseResultDto[];
}

export interface SubmissionDto {
  id: string;
  organizationId: string;
  interviewId: string;
  questionId: string;
  questionVersion: number;
  candidateUserId: string | null;
  candidateName: string;
  candidateEmail: string;
  language: string;
  sourceCode: string;
  documentVersion: number;
  submissionType?: "run" | "submit";
  status:
    | "saved"
    | "queued"
    | "processing"
    | "completed"
    | "failed"
    | "cancelled"
    | "submitted";
  sequenceNumber: number;
  submittedBy: {
    id: string;
    name: string;
    role: string;
  };
  executionResult?: ExecutionResultDto | null;
  createdAt: string;
}

export interface LiveKitTokenData {
  token: string;
  serverUrl: string;
  roomName: string;
  isConfigured: boolean;
  notice?: string;
}

export interface CandidateInvitationDto {
  invitation: {
    id: string;
    candidateName: string;
    candidateEmail: string;
    status: string;
    expiresAt: string;
    acceptedAt?: string | null;
  };
  interview: {
    id: string;
    title: string;
    description: string;
    interviewType: string;
    durationMinutes: number;
    scheduledStartAt: string | null;
    scheduledEndAt: string | null;
    timezone: string;
    status: string;
  };
  organization: {
    id: string;
    name: string;
  };
}

export async function getInterviewRoomApi(interviewId: string): Promise<InterviewRoomData> {
  const res = await fetchApi<InterviewRoomData>(`/interviews/${interviewId}/room`);
  return res.data;
}

export async function getActiveQuestionApi(interviewId: string): Promise<{
  activeQuestionId: string;
  question: QuestionSnapshotDto;
}> {
  const res = await fetchApi<{
    activeQuestionId: string;
    question: QuestionSnapshotDto;
  }>(`/interviews/${interviewId}/active-question`);
  return res.data;
}

export async function setActiveQuestionApi(
  interviewId: string,
  questionId: string,
): Promise<{
  activeQuestionId: string;
  questionTitle: string;
  switchedBy: ParticipantDto;
}> {
  const res = await fetchApi<{
    activeQuestionId: string;
    questionTitle: string;
    switchedBy: ParticipantDto;
  }>(`/interviews/${interviewId}/active-question`, {
    method: "PATCH",
    body: JSON.stringify({ questionId }),
  });
  return res.data;
}

export async function createSubmissionApi(
  interviewId: string,
  questionId: string,
  payload: {
    sourceCode: string;
    language: string;
    documentVersion?: number;
    status?: string;
    submissionType?: "run" | "submit";
    idempotencyKey?: string;
  },
): Promise<{
  submission: SubmissionDto;
  message: string;
  isDuplicate: boolean;
}> {
  const res = await fetchApi<{
    submission: SubmissionDto;
    message: string;
    isDuplicate: boolean;
  }>(`/interviews/${interviewId}/questions/${questionId}/submissions`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function getSubmissionStatusApi(
  submissionId: string,
): Promise<{
  id: string;
  status: string;
  submissionType: string;
  executionResult?: ExecutionResultDto | null;
}> {
  const res = await fetchApi<{
    id: string;
    status: string;
    submissionType: string;
    executionResult?: ExecutionResultDto | null;
  }>(`/submissions/${submissionId}/status`);
  return res.data;
}

export async function listSubmissionsApi(
  interviewId: string,
  questionId?: string,
): Promise<{ submissions: SubmissionDto[]; count: number }> {
  const query = questionId ? `?questionId=${encodeURIComponent(questionId)}` : "";
  const res = await fetchApi<{ submissions: SubmissionDto[]; count: number }>(
    `/interviews/${interviewId}/questions/${questionId || ""}/submissions${query}`,
  );
  return res.data;
}

export async function getSubmissionApi(
  submissionId: string,
): Promise<{ submission: SubmissionDto }> {
  const res = await fetchApi<{ submission: SubmissionDto }>(`/submissions/${submissionId}`);
  return res.data;
}

export async function getLiveKitTokenApi(
  interviewId: string,
): Promise<LiveKitTokenData> {
  const res = await fetchApi<LiveKitTokenData>(`/interviews/${interviewId}/livekit/token`, {
    method: "POST",
  });
  return res.data;
}

export async function getCandidateInvitationApi(
  token: string,
): Promise<CandidateInvitationDto> {
  const res = await fetchApi<CandidateInvitationDto>(`/candidate-invitations/${token}`);
  return res.data;
}

export async function acceptCandidateInvitationApi(token: string): Promise<{
  roomToken: string;
  interviewId: string;
  candidateName: string;
  candidateEmail: string;
}> {
  const res = await fetchApi<{
    roomToken: string;
    interviewId: string;
    candidateName: string;
    candidateEmail: string;
  }>(`/candidate-invitations/${token}/accept`, {
    method: "POST",
  });
  return res.data;
}

