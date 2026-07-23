"use client";

import { useAction, useMutation, usePaginatedQuery } from "convex/react";
import {
  AlertTriangle,
  History,
  LoaderCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { useCurrentProject } from "@/components/project-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const contextFields = [
  ["audience", "Audience"],
  ["problemsSolved", "Problems solved"],
  ["benefits", "Benefits"],
  ["differentiators", "Differentiators"],
  ["offers", "Offers"],
  ["outreachAngles", "Suitable outreach angles"],
  ["prohibitedClaims", "Claims that must not be invented"],
] as const;

type SkipRetention = Doc<"projects">["skipRetention"];
type ContextLists = Record<(typeof contextFields)[number][0], string>;

function contextFormValues(context: Doc<"projects">["brandContext"]) {
  return {
    whatItDoes: context.whatItDoes,
    lists: Object.fromEntries(
      contextFields.map(([key]) => [key, context[key].join("\n")]),
    ) as ContextLists,
  };
}

export default function SettingsPage() {
  const { projects, currentProject, setCreateOpen } = useCurrentProject();
  if (projects === undefined) return <SettingsLoading />;
  if (!currentProject) {
    return (
      <div className="grid min-h-[calc(100dvh-3.5rem)] place-items-center p-6 lg:min-h-dvh">
        <div className="border-foreground bg-card hard-shadow border-2 p-8">
          <h1 className="text-2xl font-bold">No project selected</h1>
          <Button
            onClick={() => setCreateOpen(true)}
            className="border-foreground mt-5 border"
          >
            <Plus /> Add project
          </Button>
        </div>
      </div>
    );
  }
  return <SettingsForm key={currentProject._id} project={currentProject} />;
}

function SettingsForm({ project }: { project: Doc<"projects"> }) {
  const router = useRouter();
  const { setCreateOpen } = useCurrentProject();
  const updateProject = useMutation(api.projects.update);
  const removeProject = useMutation(api.projects.remove);
  const restoreContext = useMutation(api.projects.restoreContext);
  const rebuildContext = useAction(api.projectActions.rebuildContext);
  const {
    results: versions,
    status: versionPaginationStatus,
    loadMore: loadMoreVersions,
  } = usePaginatedQuery(
    api.projects.contextVersions,
    { projectId: project._id },
    { initialNumItems: 20 },
  );
  const [name, setName] = useState(project.name);
  const [domain, setDomain] = useState(project.domain);
  const [senderName, setSenderName] = useState(project.senderName);
  const [senderEmail, setSenderEmail] = useState(project.senderEmail);
  const initialContext = contextFormValues(project.brandContext);
  const [whatItDoes, setWhatItDoes] = useState(initialContext.whatItDoes);
  const [lists, setLists] = useState(initialContext.lists);
  const [contextSource, setContextSource] = useState({
    generation: project.contextGeneration,
    ...initialContext,
  });
  const [settingsRevision, setSettingsRevision] = useState(
    project.settingsRevision,
  );
  const [filterInstructions, setFilterInstructions] = useState(
    project.filterInstructions,
  );
  const [draftInstructions, setDraftInstructions] = useState(
    project.draftInstructions,
  );
  const [monitorEnabled, setMonitorEnabled] = useState(project.monitorEnabled);
  const [lateSyncEnabled, setLateSyncEnabled] = useState(
    project.lateSyncEnabled,
  );
  const [skipRetention, setSkipRetention] = useState<SkipRetention>(
    project.skipRetention,
  );
  const [saving, setSaving] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const contextIsUnedited =
    whatItDoes === contextSource.whatItDoes &&
    contextFields.every(([key]) => lists[key] === contextSource.lists[key]);
  const contextHasConflict =
    contextSource.generation < project.contextGeneration && !contextIsUnedited;
  const settingsHaveConflict = settingsRevision < project.settingsRevision;

  if (
    contextSource.generation < project.contextGeneration &&
    contextIsUnedited
  ) {
    const nextContext = contextFormValues(project.brandContext);
    setContextSource({
      generation: project.contextGeneration,
      ...nextContext,
    });
    setWhatItDoes(nextContext.whatItDoes);
    setLists(nextContext.lists);
  }

  function replaceContext(context: Doc<"projects">["brandContext"]) {
    const nextContext = contextFormValues(context);
    setWhatItDoes(nextContext.whatItDoes);
    setLists(nextContext.lists);
    setContextSource({
      generation: project.contextGeneration,
      ...nextContext,
    });
  }

  function brandContext() {
    return {
      whatItDoes: whatItDoes.trim(),
      audience: lines(lists.audience),
      problemsSolved: lines(lists.problemsSolved),
      benefits: lines(lists.benefits),
      differentiators: lines(lists.differentiators),
      offers: lines(lists.offers),
      outreachAngles: lines(lists.outreachAngles),
      prohibitedClaims: lines(lists.prohibitedClaims),
    };
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const nextBrandContext = brandContext();
      const savedProject = await updateProject({
        projectId: project._id,
        expectedContextGeneration: contextSource.generation,
        expectedSettingsRevision: settingsRevision,
        name,
        domain,
        senderName,
        senderEmail,
        brandContext: nextBrandContext,
        filterInstructions,
        draftInstructions,
        monitorEnabled,
        lateSyncEnabled,
        skipRetention,
      });
      setContextSource({
        generation: savedProject.contextGeneration,
        ...contextFormValues(nextBrandContext),
      });
      setSettingsRevision(savedProject.settingsRevision);
      setMessage("Settings saved");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to save settings",
      );
    } finally {
      setSaving(false);
    }
  }

  async function rebuild() {
    setRebuilding(true);
    setError("");
    try {
      const generatedContext = await rebuildContext({
        projectId: project._id,
      });
      if (generatedContext) {
        replaceContext(generatedContext);
        setMessage("Brand context regenerated");
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to regenerate context",
      );
    } finally {
      setRebuilding(false);
    }
  }

  async function remove() {
    if (
      !window.confirm(
        `Delete ${project.name} and all of its drafts and delivery history?`,
      )
    )
      return;
    await removeProject({ projectId: project._id });
    router.push("/today");
  }

  async function restore(
    versionId: Id<"projectContextVersions">,
    context: Doc<"projects">["brandContext"],
  ) {
    setError("");
    setMessage("");
    try {
      await restoreContext({ projectId: project._id, versionId });
      replaceContext(context);
      setMessage("Brand context restored");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to restore context",
      );
    }
  }

  return (
    <form
      onSubmit={save}
      className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8"
    >
      <header className="border-foreground flex flex-col gap-4 border-b-2 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-muted-foreground font-mono text-[10px] font-semibold tracking-[0.2em] uppercase">
            Project management
          </p>
          <h1 className="mt-1 text-4xl font-bold tracking-[-0.055em] md:text-5xl">
            Settings
          </h1>
        </div>
        <div className="flex gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => setCreateOpen(true)}
            className="border-foreground border-2"
          >
            <Plus /> Add project
          </Button>
          <Button
            type="submit"
            disabled={saving || settingsHaveConflict}
            className="hard-shadow-sm border-foreground bg-accent text-accent-foreground border-2"
          >
            {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
            Save
          </Button>
        </div>
      </header>

      {settingsHaveConflict ? (
        <div className="border-destructive text-destructive mt-5 flex flex-col gap-3 border-2 p-4 sm:flex-row sm:items-center">
          <p className="text-sm">
            Project settings changed in another session. Load the latest version
            before saving.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => window.location.reload()}
            className="border-destructive ml-auto border-2"
          >
            Load latest
          </Button>
        </div>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="border-destructive text-destructive mt-5 border-l-4 pl-3 text-sm"
        >
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="border-accent mt-5 border-l-4 pl-3 text-sm font-semibold">
          {message}
        </p>
      ) : null}

      <SettingsSection
        index="01"
        title="Identity"
        description="Sender aliases must use the project's root domain."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Project name" value={name} onChange={setName} />
          <TextField label="Domain" value={domain} onChange={setDomain} />
          <TextField
            label="Sender name"
            value={senderName}
            onChange={setSenderName}
          />
          <TextField
            label="Sender email"
            value={senderEmail}
            onChange={setSenderEmail}
            type="email"
          />
        </div>
      </SettingsSection>

      <SettingsSection
        index="02"
        title="Brand context"
        description="DeepSeek generated this from the project crawl. Edit any field before drafting."
        action={
          <Button
            type="button"
            variant="outline"
            onClick={rebuild}
            disabled={rebuilding || project.contextStatus === "building"}
            className="border-foreground border-2"
          >
            {rebuilding || project.contextStatus === "building" ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <RefreshCw />
            )}
            Regenerate
          </Button>
        }
      >
        {project.contextStatus === "failed" ? (
          <div className="border-destructive text-destructive mb-4 flex gap-3 border-2 p-4">
            <AlertTriangle className="size-4 shrink-0" />
            <p className="text-sm">
              {project.contextError ?? "Context generation failed."}
            </p>
          </div>
        ) : project.contextStatus === "building" ? (
          <div className="border-foreground mb-4 flex gap-3 border-2 p-4">
            <LoaderCircle className="size-4 shrink-0 animate-spin" />
            <p className="text-sm">
              Firecrawl and DeepSeek are rebuilding this context.
            </p>
          </div>
        ) : null}
        {contextHasConflict ? (
          <div className="border-destructive text-destructive mb-4 flex flex-col gap-3 border-2 p-4 sm:flex-row sm:items-center">
            <p className="text-sm">
              Brand context changed in another session. Load the latest version
              before saving.
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => replaceContext(project.brandContext)}
              className="border-destructive ml-auto border-2"
            >
              Load latest
            </Button>
          </div>
        ) : null}
        <div className="grid gap-4">
          <TextareaField
            label="What the product does"
            value={whatItDoes}
            onChange={setWhatItDoes}
            rows={4}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            {contextFields.map(([key, label]) => (
              <TextareaField
                key={key}
                label={label}
                hint="One item per line"
                value={lists[key]}
                onChange={(value) =>
                  setLists((current) => ({ ...current, [key]: value }))
                }
                rows={6}
              />
            ))}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        index="03"
        title="Agent instructions"
        description="These are inserted into the matching system prompt."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextareaField
            label="Filter-agent custom instructions"
            value={filterInstructions}
            onChange={setFilterInstructions}
            rows={9}
            placeholder="Example: Prioritize developer tools with small founding teams."
          />
          <TextareaField
            label="Draft-agent custom instructions"
            value={draftInstructions}
            onChange={setDraftInstructions}
            rows={9}
            placeholder="Example: Ask for a 15-minute call and avoid mentioning pricing."
          />
        </div>
      </SettingsSection>

      <SettingsSection
        index="04"
        title="Automation"
        description="All scheduled times use Pakistan Standard Time."
      >
        <div className="divide-foreground border-foreground divide-y-2 border-y-2">
          <ToggleRow
            label="Weekly website monitoring"
            description="Firecrawl Monitor updates brand context after meaningful project-site changes."
            checked={monitorEnabled}
            onCheckedChange={setMonitorEnabled}
          />
          <ToggleRow
            label="1:15 PM previous-day sync"
            description="Fetch launches published after the prior day's main sync."
            checked={lateSyncEnabled}
            onCheckedChange={setLateSyncEnabled}
          />
          <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-bold">Skipped email retention</p>
              <p className="text-muted-foreground mt-1 text-xs">
                Skipped launches stay in the daily list after draft deletion.
              </p>
            </div>
            <Select
              value={skipRetention}
              onValueChange={(value) =>
                value && setSkipRetention(value as SkipRetention)
              }
            >
              <SelectTrigger className="border-foreground w-44 border-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-foreground border-2 ring-0">
                <SelectItem value="delete">Delete immediately</SelectItem>
                <SelectItem value="30">Retain 30 days</SelectItem>
                <SelectItem value="60">Retain 60 days</SelectItem>
                <SelectItem value="forever">Retain forever</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {project.monitorError ? (
          <p className="text-destructive mt-3 text-xs">
            Monitor: {project.monitorError}
          </p>
        ) : null}
      </SettingsSection>

      <SettingsSection
        index="05"
        title="Context history"
        description="Inspect or restore any previous version."
      >
        <div className="grid gap-2">
          {versionPaginationStatus === "LoadingFirstPage" ? (
            <Skeleton className="h-16 rounded-none" />
          ) : versions.length ? (
            <>
              {versions.map((version) => (
                <details
                  key={version._id}
                  className="group border-foreground bg-card border-2 p-4"
                >
                  <summary className="flex cursor-pointer list-none items-center gap-3 text-sm font-bold">
                    <History className="size-4" />
                    <span>{new Date(version.createdAt).toLocaleString()}</span>
                    <span className="text-muted-foreground font-mono text-[10px] font-medium uppercase">
                      {version.source.replaceAll("_", " ")}
                    </span>
                  </summary>
                  <pre className="border-foreground mt-4 max-h-72 overflow-auto border-t pt-4 font-mono text-[11px] leading-5 whitespace-pre-wrap">
                    {JSON.stringify(version.brandContext, null, 2)}
                  </pre>
                  <Button
                    type="button"
                    variant="outline"
                    className="border-foreground mt-4 border-2"
                    onClick={() =>
                      void restore(version._id, version.brandContext)
                    }
                  >
                    <RotateCcw /> Restore this version
                  </Button>
                </details>
              ))}
              {versionPaginationStatus === "CanLoadMore" ||
              versionPaginationStatus === "LoadingMore" ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => loadMoreVersions(20)}
                  disabled={versionPaginationStatus === "LoadingMore"}
                  className="border-foreground border-2"
                >
                  {versionPaginationStatus === "LoadingMore" ? (
                    <LoaderCircle className="animate-spin" />
                  ) : null}
                  Load more history
                </Button>
              ) : null}
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              No saved context versions yet.
            </p>
          )}
        </div>
      </SettingsSection>

      <section className="border-destructive mt-12 border-2 p-5">
        <p className="text-destructive font-mono text-[10px] font-semibold tracking-[0.18em] uppercase">
          Danger zone
        </p>
        <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-bold">Delete project</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Deletes drafts, sync runs, delivery attempts, and context history.
            </p>
          </div>
          <Button
            type="button"
            variant="destructive"
            onClick={remove}
            className="border-destructive border-2"
          >
            <Trash2 /> Delete {project.name}
          </Button>
        </div>
      </section>
    </form>
  );
}

function SettingsSection({
  index,
  title,
  description,
  action,
  children,
}: {
  index: string;
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <div className="mb-5 flex items-end gap-3">
        <span className="text-muted-foreground font-mono text-xs font-semibold">
          {index}
        </span>
        <div>
          <h2 className="text-2xl font-bold tracking-[-0.035em]">{title}</h2>
          <p className="text-muted-foreground mt-1 text-sm">{description}</p>
        </div>
        {action ? <div className="ml-auto">{action}</div> : null}
      </div>
      <Separator className="bg-foreground mb-5 h-0.5" />
      {children}
    </section>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  const id = `settings-${label.toLowerCase().replaceAll(" ", "-")}`;
  return (
    <div className="grid gap-1.5">
      <Label
        htmlFor={id}
        className="font-mono text-[10px] font-semibold tracking-wider uppercase"
      >
        {label}
      </Label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
        className="border-foreground border-2"
      />
    </div>
  );
}

function TextareaField({
  label,
  hint,
  value,
  onChange,
  rows,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
  placeholder?: string;
}) {
  const id = `settings-${label.toLowerCase().replaceAll(" ", "-")}`;
  return (
    <div className="grid gap-1.5">
      <div className="flex justify-between gap-3">
        <Label
          htmlFor={id}
          className="font-mono text-[10px] font-semibold tracking-wider uppercase"
        >
          {label}
        </Label>
        {hint ? (
          <span className="text-muted-foreground font-mono text-[9px] uppercase">
            {hint}
          </span>
        ) : null}
      </div>
      <Textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="border-foreground bg-card field-sizing-fixed resize-y border-2 leading-6"
      />
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-5 py-4">
      <span>
        <span className="block text-sm font-bold">{label}</span>
        <span className="text-muted-foreground mt-1 block text-xs">
          {description}
        </span>
      </span>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="border-foreground border"
      />
    </label>
  );
}

function lines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function SettingsLoading() {
  return (
    <div className="mx-auto max-w-5xl p-8">
      <Skeleton className="h-12 w-64 rounded-none" />
      <Skeleton className="mt-12 h-80 w-full rounded-none" />
    </div>
  );
}
