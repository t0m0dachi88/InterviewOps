import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError, type RubricDto } from "../../../lib/api-client";
import { RubricsPage } from "../pages/RubricsPage";

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  listRubricsApi: vi.fn(),
  createRubricApi: vi.fn(),
  getRubricApi: vi.fn(),
  getRubricVersionsApi: vi.fn(),
  updateRubricApi: vi.fn(),
  archiveRubricApi: vi.fn(),
}));

vi.mock("../../../context/AuthContext", () => ({ useAuth: mocks.useAuth }));
vi.mock("../../../lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/api-client")>("../../../lib/api-client");
  return {
    ...actual,
    listRubricsApi: mocks.listRubricsApi,
    createRubricApi: mocks.createRubricApi,
    getRubricApi: mocks.getRubricApi,
    getRubricVersionsApi: mocks.getRubricVersionsApi,
    updateRubricApi: mocks.updateRubricApi,
    archiveRubricApi: mocks.archiveRubricApi,
  };
});

const organization = {
  id: "64b000000000000000000001",
  name: "Northstar Engineering",
  role: "owner" as const,
};

function makeRubric(overrides: Partial<RubricDto> = {}): RubricDto {
  return {
    id: "64b000000000000000000010",
    organizationId: organization.id,
    status: "active",
    currentVersion: 2,
    activeVersion: 2,
    name: "Software Engineering",
    description: "Technical interview rubric",
    jobRole: "Software Engineer",
    assessmentId: null,
    scale: {
      min: 1,
      max: 5,
      labels: { "1": "Poor", "2": "Below expectations", "3": "Meets expectations", "4": "Strong", "5": "Excellent" },
    },
    criteria: [
      { key: "problem_solving", label: "Problem Solving", description: "Reasoning and decomposition", required: true, weight: 2 },
      { key: "communication", label: "Communication", description: "Explains decisions", required: false, weight: 1 },
    ],
    changeSummary: "Added communication criterion",
    versionCreatedBy: "64b000000000000000000002",
    versionCreatedAt: "2026-11-19T10:00:00.000Z",
    createdBy: "64b000000000000000000002",
    updatedBy: "64b000000000000000000002",
    archivedAt: null,
    createdAt: "2026-11-18T10:00:00.000Z",
    updatedAt: "2026-11-19T10:00:00.000Z",
    ...overrides,
  };
}

const rubric = makeRubric();
const history = {
  rubricId: rubric.id,
  currentVersion: 2,
  versions: [
    { version: 1, name: "Software Engineering", changeSummary: "Initial rubric", createdBy: "owner-1", createdAt: "2026-11-18T10:00:00.000Z" },
    { version: 2, name: "Software Engineering", changeSummary: "Added communication criterion", createdBy: "owner-1", createdAt: "2026-11-19T10:00:00.000Z" },
  ],
};

function setRole(role: "owner" | "admin" | "interviewer" = "owner") {
  mocks.useAuth.mockReturnValue({ activeOrg: { ...organization, role } });
}

function setupList(items: RubricDto[] = [rubric]) {
  mocks.listRubricsApi.mockResolvedValue({
    rubrics: items,
    pagination: { page: 1, limit: 20, total: items.length, totalPages: 1 },
  });
}

async function openRubric(user = userEvent.setup()) {
  await user.click(await screen.findByRole("button", { name: /Software Engineering/ }));
  await screen.findByText("Version history");
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  setRole("owner");
  setupList();
  mocks.getRubricVersionsApi.mockResolvedValue(history);
  mocks.getRubricApi.mockImplementation(async (_orgId: string, _rubricId: string, version?: number) =>
    version === 1
      ? makeRubric({ currentVersion: 2, activeVersion: 1, name: "Software Engineering v1", criteria: [rubric.criteria[0]], changeSummary: "Initial rubric" })
      : rubric,
  );
  mocks.createRubricApi.mockResolvedValue(makeRubric({ id: "64b000000000000000000099", currentVersion: 1, activeVersion: 1 }));
  mocks.updateRubricApi.mockResolvedValue(makeRubric({ currentVersion: 3, activeVersion: 3, changeSummary: "Updated rubric" }));
  mocks.archiveRubricApi.mockResolvedValue(makeRubric({ status: "archived", archivedAt: "2026-11-20T10:00:00.000Z" }));
}
);

describe("Rubric management page", () => {
  it("renders organization rubrics and current version metadata", async () => {
    render(<RubricsPage />);
    expect(await screen.findByText("Software Engineering")).toBeInTheDocument();
    expect(screen.getAllByText(/Version 2/).length).toBeGreaterThan(0);
    expect(mocks.listRubricsApi).toHaveBeenCalledWith(organization.id, { status: "active", page: 1, limit: 20 });
  });

  it("shows a loading state while the rubric list is being fetched", () => {
    mocks.listRubricsApi.mockReturnValue(new Promise(() => undefined));
    render(<RubricsPage />);
    expect(screen.getByText("Loading organization rubrics…")).toBeInTheDocument();
  });

  it("shows the empty state when the organization has no rubrics", async () => {
    setupList([]);
    render(<RubricsPage />);
    expect(await screen.findByText("No rubrics yet")).toBeInTheDocument();
  });

  it("shows a retry state when fetching rubrics fails", async () => {
    mocks.listRubricsApi.mockRejectedValue(new ApiError("Unavailable", "HTTP_ERROR", 503));
    render(<RubricsPage />);
    expect(await screen.findByText("Rubrics could not be loaded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Try again/ })).toBeInTheDocument();
  });

  it("validates the create form before making an API request", async () => {
    const user = userEvent.setup();
    render(<RubricsPage />);
    await user.click(await screen.findByRole("button", { name: "Create rubric" }));
    await user.type(screen.getByLabelText(/Rubric name/), "Platform Engineer");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Create rubric" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Criterion 1: enter a name.");
    expect(mocks.createRubricApi).not.toHaveBeenCalled();
  });

  it("creates a rubric with the backend content shape", async () => {
    const user = userEvent.setup();
    render(<RubricsPage />);
    await user.click(await screen.findByRole("button", { name: "Create rubric" }));
    await user.type(screen.getByLabelText(/Rubric name/), "Platform Engineer");
    await user.type(screen.getByLabelText(/Criterion name/), "Problem solving");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Create rubric" }));
    await waitFor(() => expect(mocks.createRubricApi).toHaveBeenCalled());
    const [orgId, payload] = mocks.createRubricApi.mock.calls[0];
    expect(orgId).toBe(organization.id);
    expect(payload).toMatchObject({
      name: "Platform Engineer",
      scale: { min: 1, max: 5, labels: expect.any(Object) },
      criteria: [{ key: "problem_solving", label: "Problem solving", required: true, weight: 1 }],
      changeSummary: "Initial rubric",
    });
  });

  it("edits a rubric by sending the current expectedVersion", async () => {
    const user = await openRubric();
    await user.click(screen.getByRole("button", { name: "Edit and create new version" }));
    const nameInput = screen.getByLabelText(/Rubric name/);
    await user.clear(nameInput);
    await user.type(nameInput, "Software Engineering Updated");
    await user.click(screen.getByRole("button", { name: /Save version 3/ }));
    await waitFor(() => expect(mocks.updateRubricApi).toHaveBeenCalled());
    expect(mocks.updateRubricApi).toHaveBeenCalledWith(
      organization.id,
      rubric.id,
      expect.objectContaining({ name: "Software Engineering Updated", expectedVersion: 2 }),
    );
  });

  it("displays version history and renders historical versions read-only", async () => {
    const user = await openRubric();
    expect(screen.getByText("Added communication criterion")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Version 1/ }));
    await waitFor(() => expect(mocks.getRubricApi).toHaveBeenCalledWith(organization.id, rubric.id, 1));
    expect(await screen.findByText(/Historical version — read-only/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit and create new version" })).not.toBeInTheDocument();
  });

  it("requires confirmation before archiving and retains the history view", async () => {
    const user = await openRubric();
    await user.click(screen.getByRole("button", { name: /Archive rubric/ }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/does not delete its existing version history/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Archive rubric" }));
    await waitFor(() => expect(mocks.archiveRubricApi).toHaveBeenCalledWith(organization.id, rubric.id));
    expect(await screen.findByText("Rubric archived. Its version history has been retained.")).toBeInTheDocument();
    expect(screen.getByText("Version history")).toBeInTheDocument();
  });

  it("allows organization admins to access rubric management controls", async () => {
    setRole("admin");
    render(<RubricsPage />);
    expect(await screen.findByRole("button", { name: "Create rubric" })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: /Software Engineering/ }));
    expect(await screen.findByRole("button", { name: "Edit and create new version" })).toBeInTheDocument();
  });

  it("gives interviewers read-only access and hides management actions", async () => {
    setRole("interviewer");
    render(<RubricsPage />);
    expect(await screen.findByText("Read-only access")).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: /Software Engineering/ }));
    expect(screen.queryByRole("button", { name: "Create rubric" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit and create new version" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Archive rubric/ })).not.toBeInTheDocument();
  });

  it("shows a safe permission message for forbidden list access", async () => {
    mocks.listRubricsApi.mockRejectedValue(new ApiError("Forbidden internal detail", "FORBIDDEN", 403));
    render(<RubricsPage />);
    expect(await screen.findByText(/do not have permission to perform this action/)).toBeInTheDocument();
    expect(screen.queryByText("Forbidden internal detail")).not.toBeInTheDocument();
  });

  it("handles stale-version conflicts without overwriting and offers a reload", async () => {
    const user = await openRubric();
    mocks.updateRubricApi.mockRejectedValue(new ApiError("Conflict", "CONFLICT", 409));
    await user.click(screen.getByRole("button", { name: "Edit and create new version" }));
    const nameInput = screen.getByLabelText(/Rubric name/);
    await user.clear(nameInput);
    await user.type(nameInput, "Conflicting edit");
    await user.click(screen.getByRole("button", { name: /Save version 3/ }));
    expect(await screen.findByText(/Your changes have not been applied/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Reload latest version/ }));
    await waitFor(() => expect(mocks.getRubricApi).toHaveBeenCalledWith(organization.id, rubric.id));
    expect(await screen.findByText(/latest rubric version has been reloaded/i)).toBeInTheDocument();
    expect(mocks.updateRubricApi).toHaveBeenCalledTimes(1);
  });

  it("shows an organization selection state when no organization is active", () => {
    mocks.useAuth.mockReturnValue({ activeOrg: null });
    render(<RubricsPage />);
    expect(screen.getByRole("heading", { name: "Select an organization" })).toBeInTheDocument();
    expect(mocks.listRubricsApi).not.toHaveBeenCalled();
  });
});
