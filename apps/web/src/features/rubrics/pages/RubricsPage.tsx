import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Archive,
  ArrowDownRight,
  BookOpenCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  History,
  Loader2,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useAuth } from "../../../context/AuthContext";
import {
  ApiError,
  archiveRubricApi,
  createRubricApi,
  getRubricApi,
  getRubricVersionsApi,
  listRubricsApi,
  updateRubricApi,
  type RubricContentInput,
  type RubricDto,
  type RubricVersionMetadataDto,
} from "../../../lib/api-client";
import { RubricFormModal } from "../components/RubricFormModal";

type RubricStatusFilter = "active" | "archived" | "all";

function friendlyError(error: unknown, fallback: string) {
  if (!(error instanceof ApiError)) return fallback;
  if (error.statusCode === 0) return "Unable to reach Interview Ops. Check your connection and try again.";
  if (error.statusCode === 401) return "Your session may have expired. Sign in again to continue.";
  if (error.statusCode === 403) return "You do not have permission to perform this action in this organization.";
  if (error.statusCode === 404) return "This rubric is unavailable in the active organization.";
  if (error.statusCode === 409) return "This rubric changed after you opened it. Reload the latest version before making another change.";
  if (error.statusCode === 400) return error.message || "Some rubric information is invalid. Review the fields and try again.";
  return fallback;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export const RubricsPage: React.FC = () => {
  const { activeOrg } = useAuth();
  const organizationId = activeOrg?.id;
  const canManage = activeOrg?.role === "owner" || activeOrg?.role === "admin";

  const [statusFilter, setStatusFilter] = useState<RubricStatusFilter>("active");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [rubrics, setRubrics] = useState<RubricDto[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [isLoading, setIsLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [selectedRubric, setSelectedRubric] = useState<RubricDto | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [versionHistory, setVersionHistory] = useState<RubricVersionMetadataDto[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [isLoadingVersionDetail, setIsLoadingVersionDetail] = useState(false);
  const [versionError, setVersionError] = useState<string | null>(null);
  const detailRequestId = useRef(0);
  const listRequestId = useRef(0);

  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [conflictRubricId, setConflictRubricId] = useState<string | null>(null);

  const loadRubrics = useCallback(async () => {
    const requestId = ++listRequestId.current;
    if (!organizationId) {
      setRubrics([]);
      setPagination({ page: 1, limit: 20, total: 0, totalPages: 1 });
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setListError(null);
    try {
      const result = await listRubricsApi(organizationId, {
        status: statusFilter,
        page,
        limit: 20,
      });
      if (listRequestId.current === requestId) {
        setRubrics(result.rubrics);
        setPagination(result.pagination || { page, limit: 20, total: result.rubrics.length, totalPages: 1 });
      }
    } catch (error) {
      if (listRequestId.current === requestId) {
        setListError(friendlyError(error, "Rubrics could not be loaded. Please try again."));
      }
    } finally {
      if (listRequestId.current === requestId) setIsLoading(false);
    }
  }, [organizationId, statusFilter, page]);

  useEffect(() => {
    listRequestId.current += 1;
    detailRequestId.current += 1;
    setRubrics([]);
    setListError(null);
    setSelectedRubric(null);
    setSelectedVersion(null);
    setVersionHistory([]);
    setNotice(null);
    setActionError(null);
    setPage(1);
  }, [organizationId]);

  useEffect(() => {
    void loadRubrics();
  }, [loadRubrics]);

  const visibleRubrics = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    if (!normalized) return rubrics;
    return rubrics.filter((rubric) =>
      [rubric.name, rubric.description, rubric.jobRole]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(normalized)),
    );
  }, [rubrics, search]);

  const selectRubric = async (rubric: RubricDto) => {
    detailRequestId.current += 1;
    const requestId = detailRequestId.current;
    setSelectedRubric(rubric);
    setSelectedVersion(rubric.currentVersion);
    setVersionHistory([]);
    setVersionError(null);
    setIsLoadingVersions(true);
    setActionError(null);
    try {
      if (!organizationId) return;
      const history = await getRubricVersionsApi(organizationId, rubric.id);
      if (detailRequestId.current === requestId) setVersionHistory(history.versions);
    } catch (error) {
      if (detailRequestId.current === requestId) {
        setVersionError(friendlyError(error, "Version history could not be loaded."));
      }
    } finally {
      if (detailRequestId.current === requestId) setIsLoadingVersions(false);
    }
  };

  const retryVersionHistory = async () => {
    if (!organizationId || !selectedRubric) return;
    detailRequestId.current += 1;
    const requestId = detailRequestId.current;
    setIsLoadingVersions(true);
    setVersionError(null);
    try {
      const history = await getRubricVersionsApi(organizationId, selectedRubric.id);
      if (detailRequestId.current === requestId) setVersionHistory(history.versions);
    } catch (error) {
      if (detailRequestId.current === requestId) {
        setVersionError(friendlyError(error, "Version history could not be loaded."));
      }
    } finally {
      if (detailRequestId.current === requestId) setIsLoadingVersions(false);
    }
  };

  const inspectVersion = async (version: number) => {
    if (!organizationId || !selectedRubric) return;
    detailRequestId.current += 1;
    const requestId = detailRequestId.current;
    setSelectedVersion(version);
    setIsLoadingVersionDetail(true);
    setVersionError(null);
    try {
      const detail = await getRubricApi(organizationId, selectedRubric.id, version);
      if (detailRequestId.current === requestId) setSelectedRubric((current) => current?.id === detail.id ? detail : current);
    } catch (error) {
      if (detailRequestId.current === requestId) {
        setVersionError(friendlyError(error, "This rubric version could not be loaded."));
      }
    } finally {
      if (detailRequestId.current === requestId) setIsLoadingVersionDetail(false);
    }
  };

  const reloadLatestRubric = async () => {
    if (!organizationId || !conflictRubricId) return;
    setActionError(null);
    setFormMode(null);
    try {
      const [latest] = await Promise.all([
        getRubricApi(organizationId, conflictRubricId),
        loadRubrics(),
      ]);
      await selectRubric(latest);
      setNotice("The latest rubric version has been reloaded. Review it before making further changes.");
    } catch (error) {
      setActionError(friendlyError(error, "The latest rubric version could not be reloaded."));
    } finally {
      setConflictRubricId(null);
    }
  };

  const handleSaveRubric = async (payload: RubricContentInput) => {
    if (!organizationId) return;
    setIsSaving(true);
    setActionError(null);
    setNotice(null);
    try {
      let saved: RubricDto;
      if (formMode === "edit" && selectedRubric) {
        saved = await updateRubricApi(organizationId, selectedRubric.id, {
          ...payload,
          expectedVersion: selectedRubric.currentVersion,
        });
        setNotice(`Rubric saved as version ${saved.currentVersion}. Previous versions remain unchanged.`);
      } else {
        saved = await createRubricApi(organizationId, payload);
        setNotice("Rubric created successfully.");
      }
      setFormMode(null);
      await loadRubrics();
      await selectRubric(saved);
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 409 && selectedRubric) {
        setConflictRubricId(selectedRubric.id);
        setActionError("This rubric changed since you opened it. Your changes have not been applied. Reload the latest version to continue.");
      } else {
        setActionError(friendlyError(error, "The rubric could not be saved. Please try again."));
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleArchive = async () => {
    if (!organizationId || !selectedRubric) return;
    setIsArchiving(true);
    setActionError(null);
    try {
      const archived = await archiveRubricApi(organizationId, selectedRubric.id);
      setSelectedRubric(archived);
      setSelectedVersion(archived.currentVersion);
      setShowArchiveConfirm(false);
      setNotice("Rubric archived. Its version history has been retained.");
      await loadRubrics();
    } catch (error) {
      setActionError(friendlyError(error, "The rubric could not be archived."));
    } finally {
      setIsArchiving(false);
    }
  };

  if (!activeOrg) {
    return (
      <div className="mx-auto max-w-3xl rounded-2xl border border-slate-800 bg-slate-900/70 p-8 text-center">
        <BookOpenCheck className="mx-auto h-10 w-10 text-slate-500" />
        <h1 className="mt-4 text-xl font-bold text-white">Select an organization</h1>
        <p className="mt-2 text-sm text-slate-400">Choose or create an organization from the dashboard before managing its rubrics.</p>
        <Link to="/dashboard" className="mt-5 inline-flex rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500">Open dashboard</Link>
      </div>
    );
  }

  const isCurrentVersion = Boolean(selectedRubric && selectedVersion === selectedRubric.currentVersion);
  const canEditSelected = Boolean(canManage && selectedRubric?.status === "active" && isCurrentVersion);

  return (
    <div className="space-y-7">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-400">
            <BookOpenCheck className="h-4 w-4" /> Organization management
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">Evaluation rubrics</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            Create reusable, versioned criteria for consistent human-led technical interviews in <span className="font-medium text-slate-200">{activeOrg.name}</span>.
          </p>
        </div>
        {canManage ? (
          <button onClick={() => { setActionError(null); setFormMode("create"); }} className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-950/30 transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 focus:ring-offset-slate-950">
            <Plus className="h-4 w-4" /> Create rubric
          </button>
        ) : (
          <div className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-300">
            <LockKeyhole className="h-4 w-4 text-slate-400" /> Read-only access
          </div>
        )}
      </div>

      {notice && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          <span className="flex items-center gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</span>
          <button aria-label="Dismiss notice" onClick={() => setNotice(null)} className="rounded p-1 text-emerald-200/70 hover:bg-emerald-500/10 hover:text-emerald-100"><X className="h-4 w-4" /></button>
        </div>
      )}

      {actionError && (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200 sm:flex-row sm:items-center sm:justify-between">
          <span>{actionError}</span>
          {conflictRubricId && (
            <button onClick={() => void reloadLatestRubric()} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-rose-400/30 px-3 py-2 font-semibold text-rose-100 hover:bg-rose-500/10">
              <RefreshCw className="h-4 w-4" /> Reload latest version
            </button>
          )}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/65">
          <div className="border-b border-slate-800 p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-white">Rubric library</h2>
                <p className="mt-1 text-xs text-slate-500">{pagination.total} {pagination.total === 1 ? "rubric" : "rubrics"} in this view</p>
              </div>
              <div className="flex flex-wrap gap-1 rounded-lg border border-slate-800 bg-slate-950 p-1" aria-label="Filter rubrics by status">
                {(["active", "archived", "all"] as RubricStatusFilter[]).map((status) => (
                  <button key={status} onClick={() => { setStatusFilter(status); setPage(1); }} aria-pressed={statusFilter === status} className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition ${statusFilter === status ? "bg-slate-800 text-white shadow" : "text-slate-400 hover:text-slate-200"}`}>
                    {status}
                  </button>
                ))}
              </div>
            </div>
            <label className="relative mt-4 block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search rubrics on this page" aria-label="Search rubrics" className="w-full rounded-xl border border-slate-800 bg-slate-950 py-2.5 pl-9 pr-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20" />
            </label>
          </div>

          {isLoading ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-slate-400" role="status">
              <Loader2 className="h-7 w-7 animate-spin text-indigo-400" />
              <span className="text-sm">Loading organization rubrics…</span>
            </div>
          ) : listError ? (
            <div className="flex min-h-64 flex-col items-center justify-center p-8 text-center">
              <div className="rounded-full bg-rose-500/10 p-3 text-rose-300"><ShieldCheck className="h-6 w-6" /></div>
              <p className="mt-3 text-sm font-semibold text-white">Rubrics could not be loaded</p>
              <p className="mt-1 max-w-sm text-sm text-slate-400">{listError}</p>
              <button onClick={() => void loadRubrics()} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"><RefreshCw className="h-4 w-4" /> Try again</button>
            </div>
          ) : visibleRubrics.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center p-8 text-center">
              <div className="rounded-full bg-slate-800 p-3 text-slate-400"><FileText className="h-6 w-6" /></div>
              <h3 className="mt-3 text-sm font-semibold text-white">{search ? "No matching rubrics" : statusFilter === "archived" ? "No archived rubrics" : "No rubrics yet"}</h3>
              <p className="mt-1 max-w-sm text-sm text-slate-400">{search ? "Try another search term." : statusFilter === "archived" ? "Archived rubrics will appear here." : "Create your first rubric to establish consistent interview evaluation criteria."}</p>
              {canManage && !search && statusFilter !== "archived" && (
                <button onClick={() => setFormMode("create")} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500"><Plus className="h-4 w-4" /> Create rubric</button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-slate-800/80">
              {visibleRubrics.map((rubric) => (
                <button key={rubric.id} onClick={() => void selectRubric(rubric)} aria-pressed={selectedRubric?.id === rubric.id} className={`block w-full p-4 text-left transition hover:bg-slate-800/50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500 sm:p-5 ${selectedRubric?.id === rubric.id ? "bg-indigo-500/[0.07]" : ""}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold text-white">{rubric.name}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${rubric.status === "active" ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300" : "border-slate-600 bg-slate-800 text-slate-400"}`}>{rubric.status}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">{rubric.description || "No description provided."}</p>
                    </div>
                    <span className="shrink-0 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs font-semibold text-slate-300">v{rubric.currentVersion}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
                    {rubric.jobRole && <span>{rubric.jobRole}</span>}
                    <span>{rubric.criteria.length} criteria</span>
                    <span>Updated {formatDate(rubric.updatedAt)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {!isLoading && !listError && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-800 px-4 py-3 text-xs text-slate-400">
              <span>Page {pagination.page} of {pagination.totalPages}</span>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-lg border border-slate-700 p-2 hover:bg-slate-800 disabled:opacity-30" aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
                <button disabled={page >= pagination.totalPages} onClick={() => setPage((current) => Math.min(pagination.totalPages, current + 1))} className="rounded-lg border border-slate-700 p-2 hover:bg-slate-800 disabled:opacity-30" aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
              </div>
            </div>
          )}
        </section>

        <section className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/65">
          {!selectedRubric ? (
            <div className="flex min-h-[420px] flex-col items-center justify-center p-8 text-center">
              <div className="rounded-full border border-slate-800 bg-slate-950 p-4 text-slate-500"><SlidersHorizontal className="h-7 w-7" /></div>
              <h2 className="mt-4 text-base font-semibold text-white">Rubric details</h2>
              <p className="mt-1 max-w-xs text-sm leading-6 text-slate-400">Select a rubric from the library to inspect its criteria and version history.</p>
            </div>
          ) : (
            <>
              <div className="border-b border-slate-800 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="break-words text-lg font-bold text-white">{selectedRubric.name}</h2>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${selectedRubric.status === "active" ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300" : "border-slate-600 bg-slate-800 text-slate-400"}`}>{selectedRubric.status}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{selectedRubric.jobRole || "General role"} · Version {selectedVersion ?? selectedRubric.currentVersion}</p>
                  </div>
                  <button onClick={() => { setSelectedRubric(null); setVersionHistory([]); }} aria-label="Close rubric details" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-800 hover:text-white"><X className="h-4 w-4" /></button>
                </div>
                {selectedRubric.description && <p className="mt-4 text-sm leading-6 text-slate-300">{selectedRubric.description}</p>}
                {selectedRubric.status === "archived" && <div className="mt-4 rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-xs text-slate-400">This rubric is archived. Its historical versions remain available for reference.</div>}
                {!isCurrentVersion && <div className="mt-4 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">Historical version — read-only. Changes to the current rubric do not alter this version.</div>}
                <div className="mt-4 flex flex-wrap gap-2">
                  {canEditSelected && (
                    <button onClick={() => { setActionError(null); setFormMode("edit"); }} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500">Edit and create new version</button>
                  )}
                  {canManage && selectedRubric.status === "active" && isCurrentVersion && (
                    <button onClick={() => setShowArchiveConfirm(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-200"><Archive className="h-3.5 w-3.5" /> Archive rubric</button>
                  )}
                </div>
              </div>

              <div className="space-y-5 p-5">
                <section>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white">Criteria</h3>
                    <span className="text-xs text-slate-500">{selectedRubric.criteria.length} total</span>
                  </div>
                  {isLoadingVersionDetail ? (
                    <div className="flex items-center gap-2 py-8 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading version…</div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {selectedRubric.criteria.map((criterion, index) => (
                        <div key={`${criterion.key}-${index}`} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-slate-100">{index + 1}. {criterion.label}</p>
                              {criterion.description && <p className="mt-1 text-xs leading-5 text-slate-400">{criterion.description}</p>}
                              <p className="mt-2 font-mono text-[10px] text-slate-600">{criterion.key}</p>
                            </div>
                            <div className="shrink-0 text-right">
                              <span className="text-sm font-semibold text-indigo-300">{criterion.weight}</span>
                              <p className="text-[10px] text-slate-500">weight</p>
                              <span className={`mt-1 inline-block text-[10px] ${criterion.required ? "text-emerald-300" : "text-slate-500"}`}>{criterion.required ? "Required" : "Optional"}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section>
                  <h3 className="text-sm font-semibold text-white">Scoring scale</h3>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {Array.from({ length: selectedRubric.scale.max - selectedRubric.scale.min + 1 }, (_, index) => selectedRubric.scale.min + index).map((value) => (
                      <div key={value} className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2">
                        <span className="text-xs font-bold text-indigo-300">{value}</span>
                        <p className="mt-0.5 truncate text-xs text-slate-400">{selectedRubric.scale.labels?.[String(value)] || "—"}</p>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="border-t border-slate-800 pt-5">
                  <div className="flex items-center gap-2">
                    <History className="h-4 w-4 text-indigo-400" />
                    <h3 className="text-sm font-semibold text-white">Version history</h3>
                  </div>
                  {isLoadingVersions ? (
                    <div className="mt-3 flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading version history…</div>
                  ) : versionError ? (
                    <div className="mt-3 rounded-lg border border-rose-500/25 bg-rose-500/10 p-3 text-xs text-rose-200">
                      {versionError}
                      <button onClick={() => void retryVersionHistory()} className="ml-2 underline underline-offset-2">Retry</button>
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {versionHistory.map((version) => (
                        <button key={version.version} onClick={() => void inspectVersion(version.version)} aria-pressed={selectedVersion === version.version} className={`flex w-full items-start justify-between gap-3 rounded-lg border px-3 py-3 text-left transition ${selectedVersion === version.version ? "border-indigo-500/40 bg-indigo-500/10" : "border-slate-800 bg-slate-950/50 hover:bg-slate-800/60"}`}>
                          <span className="min-w-0">
                            <span className="flex items-center gap-2 text-xs font-semibold text-slate-200">Version {version.version}{version.version === selectedRubric.currentVersion && <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] uppercase text-emerald-300">Current</span>}</span>
                            <span className="mt-1 block truncate text-xs text-slate-400">{version.changeSummary || version.name}</span>
                            <span className="mt-1 flex items-center gap-1 text-[10px] text-slate-600"><Clock3 className="h-3 w-3" />{formatDate(version.createdAt)}</span>
                          </span>
                          <ArrowDownRight className="mt-1 h-4 w-4 shrink-0 text-slate-500" />
                        </button>
                      ))}
                      {versionHistory.length === 0 && <p className="text-xs text-slate-500">No version metadata is available.</p>}
                    </div>
                  )}
                </section>

                <div className="grid gap-2 border-t border-slate-800 pt-4 text-[11px] text-slate-500 sm:grid-cols-2">
                  <p>Created {formatDate(selectedRubric.createdAt)}</p>
                  <p>Updated {formatDate(selectedRubric.updatedAt)}</p>
                  <p>Version authored {formatDate(selectedRubric.versionCreatedAt)}</p>
                  <p>Change: {selectedRubric.changeSummary || "—"}</p>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {formMode && (
        <RubricFormModal
          mode={formMode}
          rubric={formMode === "edit" ? selectedRubric || undefined : undefined}
          isSaving={isSaving}
          onClose={() => !isSaving && setFormMode(null)}
          onSubmit={handleSaveRubric}
        />
      )}

      {showArchiveConfirm && selectedRubric && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <section role="alertdialog" aria-modal="true" aria-labelledby="archive-title" aria-describedby="archive-description" className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/10 text-amber-300"><Archive className="h-5 w-5" /></div>
            <h2 id="archive-title" className="mt-4 text-lg font-bold text-white">Archive this rubric?</h2>
            <p id="archive-description" className="mt-2 text-sm leading-6 text-slate-400">“{selectedRubric.name}” will no longer be available for new rubric versions. Archiving does not delete its existing version history or historical evaluation data.</p>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button onClick={() => setShowArchiveConfirm(false)} disabled={isArchiving} className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-50">Cancel</button>
              <button onClick={() => void handleArchive()} disabled={isArchiving} className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-50">{isArchiving && <Loader2 className="h-4 w-4 animate-spin" />}{isArchiving ? "Archiving…" : "Archive rubric"}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
