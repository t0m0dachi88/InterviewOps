import React, { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Save, Trash2, X } from "lucide-react";
import type {
  RubricContentInput,
  RubricCriterionDto,
  RubricDto,
} from "../../../lib/api-client";

type CriterionDraft = RubricCriterionDto & {
  clientId: string;
  keyTouched: boolean;
};

interface RubricFormModalProps {
  mode: "create" | "edit";
  rubric?: RubricDto;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (payload: RubricContentInput) => Promise<void>;
}

const DEFAULT_SCALE_LABELS: Record<string, string> = {
  "1": "Poor",
  "2": "Below expectations",
  "3": "Meets expectations",
  "4": "Strong",
  "5": "Excellent",
};

let draftSequence = 0;
function newClientId() {
  draftSequence += 1;
  return `criterion-${draftSequence}`;
}

function makeCriterion(
  criterion?: RubricCriterionDto,
): CriterionDraft {
  return {
    key: criterion?.key || "",
    label: criterion?.label || "",
    description: criterion?.description || "",
    required: criterion?.required ?? true,
    weight: criterion?.weight ?? 1,
    clientId: newClientId(),
    keyTouched: Boolean(criterion?.key),
  };
}

function keyFromLabel(label: string) {
  return label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 64);
}

function validateDraft(
  name: string,
  criteria: CriterionDraft[],
): string[] {
  const errors: string[] = [];
  if (!name.trim()) errors.push("Enter a rubric name.");
  if (name.trim().length > 180) errors.push("Rubric name must be 180 characters or fewer.");
  if (criteria.length < 1 || criteria.length > 30) {
    errors.push("Add between 1 and 30 evaluation criteria.");
  }
  const keys = new Set<string>();
  criteria.forEach((criterion, index) => {
    const label = criterion.label.trim();
    const key = criterion.key.trim();
    if (!label) errors.push(`Criterion ${index + 1}: enter a name.`);
    if (!/^[a-z][a-z0-9_]*$/.test(key)) {
      errors.push(`Criterion ${index + 1}: use a lowercase key beginning with a letter (letters, numbers and underscores only).`);
    } else if (keys.has(key)) {
      errors.push(`Criterion ${index + 1}: criterion keys must be unique.`);
    }
    keys.add(key);
    if (!Number.isFinite(criterion.weight) || criterion.weight < 0 || criterion.weight > 100) {
      errors.push(`Criterion ${index + 1}: weight must be between 0 and 100.`);
    }
  });
  if (!criteria.some((criterion) => criterion.weight > 0)) {
    errors.push("At least one criterion must have a weight greater than zero.");
  }
  return errors;
}

export const RubricFormModal: React.FC<RubricFormModalProps> = ({
  mode,
  rubric,
  isSaving,
  onClose,
  onSubmit,
}) => {
  const [name, setName] = useState(rubric?.name || "");
  const [description, setDescription] = useState(rubric?.description || "");
  const [jobRole, setJobRole] = useState(rubric?.jobRole || "");
  const [changeSummary, setChangeSummary] = useState("");
  const [scaleMin, setScaleMin] = useState(rubric?.scale.min || 1);
  const [scaleMax, setScaleMax] = useState(rubric?.scale.max || 5);
  const [scaleLabels, setScaleLabels] = useState<Record<string, string>>({
    ...DEFAULT_SCALE_LABELS,
    ...(rubric?.scale.labels || {}),
  });
  const [criteria, setCriteria] = useState<CriterionDraft[]>(
    rubric?.criteria.map(makeCriterion) || [makeCriterion()],
  );
  const [errors, setErrors] = useState<string[]>([]);

  const scaleValues = useMemo(
    () => Array.from({ length: scaleMax - scaleMin + 1 }, (_, index) => index + scaleMin),
    [scaleMin, scaleMax],
  );

  const updateCriterion = (
    clientId: string,
    patch: Partial<CriterionDraft>,
  ) => {
    setCriteria((current) =>
      current.map((criterion) =>
        criterion.clientId === clientId ? { ...criterion, ...patch } : criterion,
      ),
    );
  };

  const handleLabelChange = (criterion: CriterionDraft, value: string) => {
    const patch: Partial<CriterionDraft> = { label: value };
    if (!criterion.keyTouched) patch.key = keyFromLabel(value);
    updateCriterion(criterion.clientId, patch);
  };

  const moveCriterion = (index: number, direction: -1 | 1) => {
    setCriteria((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const validationErrors = validateDraft(name, criteria);
    if (!description.trim()) {
      // The backend permits an empty description; this is intentionally optional.
    }
    if (description.length > 2000) validationErrors.push("Description must be 2,000 characters or fewer.");
    if (jobRole.length > 180) validationErrors.push("Job role must be 180 characters or fewer.");
    if (changeSummary.length > 500) validationErrors.push("Change summary must be 500 characters or fewer.");
    setErrors(validationErrors);
    if (validationErrors.length) return;

    const labels = Object.fromEntries(
      scaleValues
        .map((value): [string, string] => [String(value), (scaleLabels[String(value)] || "").trim()])
        .filter(([, label]) => Boolean(label)),
    ) as Record<string, string>;

    await onSubmit({
      name: name.trim(),
      description: description.trim(),
      jobRole: jobRole.trim(),
      scale: { min: scaleMin, max: scaleMax, labels },
      criteria: criteria.map((criterion) => ({
        key: criterion.key.trim(),
        label: criterion.label.trim(),
        description: criterion.description.trim(),
        required: criterion.required,
        weight: criterion.weight,
      })),
      changeSummary: changeSummary.trim() || (mode === "create" ? "Initial rubric" : "Rubric updated"),
    });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="rubric-form-title"
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
      >
        <header className="flex items-start justify-between border-b border-slate-800 px-5 py-4 sm:px-7">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-400">
              Organization rubric
            </p>
            <h2 id="rubric-form-title" className="mt-1 text-xl font-bold text-white">
              {mode === "create" ? "Create rubric" : "Create a new version"}
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              {mode === "edit"
                ? `Saving creates version ${(rubric?.currentVersion || 0) + 1}. Earlier versions remain unchanged.`
                : "Define the criteria your interviewers will use to evaluate candidates."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            aria-label="Close rubric form"
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-7 px-5 py-6 sm:px-7">
            {errors.length > 0 && (
              <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
                <p className="font-semibold">Please review the following:</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {errors.map((error) => <li key={error}>{error}</li>)}
                </ul>
              </div>
            )}

            <div className="grid gap-5 md:grid-cols-2">
              <label className="block md:col-span-2">
                <span className="mb-2 block text-sm font-medium text-slate-200">Rubric name <span className="text-rose-400">*</span></span>
                <input
                  autoFocus
                  maxLength={180}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Software Engineering Interview"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                />
              </label>
              <label className="block md:col-span-2">
                <span className="mb-2 block text-sm font-medium text-slate-200">Description</span>
                <textarea
                  rows={3}
                  maxLength={2000}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Describe the purpose and intended use of this rubric."
                  className="w-full resize-y rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                />
                <span className="mt-1 block text-right text-xs text-slate-500">{description.length}/2,000</span>
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-200">Job role</span>
                <input
                  maxLength={180}
                  value={jobRole}
                  onChange={(event) => setJobRole(event.target.value)}
                  placeholder="e.g. Backend Engineer"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                />
              </label>
              <div className="block">
                <span className="mb-2 block text-sm font-medium text-slate-200">Scoring scale</span>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-xs text-slate-400">Minimum</span>
                    <select
                      value={scaleMin}
                      onChange={(event) => {
                        const nextMin = Number(event.target.value);
                        setScaleMin(nextMin);
                        if (scaleMax <= nextMin) setScaleMax(Math.min(10, nextMin + 1));
                      }}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                    >
                      {Array.from({ length: 9 }, (_, index) => index + 1).map((min) => (
                        <option key={min} value={min}>{min}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-slate-400">Maximum</span>
                    <select
                      value={scaleMax}
                      onChange={(event) => setScaleMax(Number(event.target.value))}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                    >
                      {Array.from({ length: 10 - scaleMin }, (_, index) => index + scaleMin + 1).map((max) => (
                        <option key={max} value={max}>{max}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <span className="mt-1 block text-xs text-slate-500">The backend supports increasing integer scales within 1–10.</span>
              </div>
            </div>

            <section className="space-y-3">
              <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
                <div>
                  <h3 className="text-base font-semibold text-white">Evaluation criteria</h3>
                  <p className="mt-1 text-sm text-slate-400">Add 1–30 criteria. At least one criterion must have a positive weight.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setCriteria((current) => current.length < 30 ? [...current, makeCriterion()] : current)}
                  disabled={criteria.length >= 30}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-2 text-sm font-semibold text-indigo-300 hover:bg-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Plus className="h-4 w-4" /> Add criterion
                </button>
              </div>

              <div className="space-y-3">
                {criteria.map((criterion, index) => (
                  <article key={criterion.clientId} className="rounded-xl border border-slate-700 bg-slate-950/70 p-4 sm:p-5">
                    <div className="mb-4 flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Criterion {index + 1}</span>
                      <div className="flex items-center gap-1">
                        <button type="button" aria-label={`Move criterion ${index + 1} up`} disabled={index === 0} onClick={() => moveCriterion(index, -1)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                        <button type="button" aria-label={`Move criterion ${index + 1} down`} disabled={index === criteria.length - 1} onClick={() => moveCriterion(index, 1)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
                        <button type="button" aria-label={`Remove criterion ${index + 1}`} disabled={criteria.length <= 1} onClick={() => setCriteria((current) => current.filter((item) => item.clientId !== criterion.clientId))} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="block">
                        <span className="mb-1.5 block text-xs font-medium text-slate-300">Criterion name <span className="text-rose-400">*</span></span>
                        <input maxLength={120} value={criterion.label} onChange={(event) => handleLabelChange(criterion, event.target.value)} placeholder="e.g. Problem solving" className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20" />
                      </label>
                      <label className="block">
                        <span className="mb-1.5 block text-xs font-medium text-slate-300">Criterion key</span>
                        <input maxLength={64} value={criterion.key} onChange={(event) => updateCriterion(criterion.clientId, { key: event.target.value, keyTouched: true })} placeholder="problem_solving" className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 font-mono text-sm text-white outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20" />
                        <span className="mt-1 block text-[11px] text-slate-500">Unique lowercase letters, numbers and underscores.</span>
                      </label>
                      <label className="block md:col-span-2">
                        <span className="mb-1.5 block text-xs font-medium text-slate-300">Description</span>
                        <textarea rows={2} maxLength={1000} value={criterion.description} onChange={(event) => updateCriterion(criterion.clientId, { description: event.target.value })} placeholder="What should the interviewer assess?" className="w-full resize-y rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20" />
                      </label>
                      <label className="block">
                        <span className="mb-1.5 block text-xs font-medium text-slate-300">Weight (0–100)</span>
                        <input type="number" min="0" max="100" step="0.1" value={criterion.weight} onChange={(event) => updateCriterion(criterion.clientId, { weight: event.target.value === "" ? 0 : Number(event.target.value) })} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20" />
                      </label>
                      <label className="flex items-center gap-2 self-center text-sm text-slate-300">
                        <input type="checkbox" checked={criterion.required} onChange={(event) => updateCriterion(criterion.clientId, { required: event.target.checked })} className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-indigo-500 focus:ring-indigo-500" />
                        Required criterion
                      </label>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <div>
                <h3 className="text-base font-semibold text-white">Rating labels</h3>
                <p className="mt-1 text-sm text-slate-400">Labels are optional. Blank labels are omitted from the API payload.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {scaleValues.map((value) => (
                  <label key={value} className="block">
                    <span className="mb-1.5 block text-xs font-medium text-slate-300">Rating {value}</span>
                    <input maxLength={100} value={scaleLabels[String(value)] || ""} onChange={(event) => setScaleLabels((current) => ({ ...current, [String(value)]: event.target.value }))} placeholder={`Rating ${value}`} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20" />
                  </label>
                ))}
              </div>
            </section>

            {mode === "edit" && (
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-200">Change summary</span>
                <input maxLength={500} value={changeSummary} onChange={(event) => setChangeSummary(event.target.value)} placeholder="Briefly describe what changed in this version" className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20" />
              </label>
            )}
          </div>

          <footer className="sticky bottom-0 flex flex-col-reverse gap-3 border-t border-slate-800 bg-slate-900 px-5 py-4 sm:flex-row sm:justify-end sm:px-7">
            <button type="button" onClick={onClose} disabled={isSaving} className="rounded-xl border border-slate-700 px-5 py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={isSaving} className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-950/30 hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60">
              <Save className="h-4 w-4" />
              {isSaving ? "Saving…" : mode === "create" ? "Create rubric" : `Save version ${(rubric?.currentVersion || 0) + 1}`}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
};
