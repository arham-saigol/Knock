"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowUpRight,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";

import { api } from "../../../../convex/_generated/api";
import { ReviewQueue } from "@/components/review-queue";
import { useCurrentProject } from "@/components/project-context";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function TodayPage() {
  const { projects, currentProject, currentProjectId, setCreateOpen } =
    useCurrentProject();
  const launches = useQuery(
    api.launches.today,
    currentProjectId ? { projectId: currentProjectId } : "skip",
  );
  const queue = useQuery(
    api.launches.reviewQueue,
    currentProjectId ? { projectId: currentProjectId } : "skip",
  );
  const syncNow = useAction(api.syncActions.manualSync);
  const retryLaunch = useMutation(api.launches.retry);
  const [syncing, setSyncing] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [error, setError] = useState("");

  async function sync() {
    if (!currentProjectId || syncing) return;
    setSyncing(true);
    setError("");
    try {
      await syncNow({ projectId: currentProjectId });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  if (projects === undefined) return <TodayLoading />;
  if (!projects.length || !currentProject) {
    return (
      <div className="grid min-h-[calc(100dvh-3.5rem)] place-items-center p-6 lg:min-h-dvh">
        <div className="hard-shadow border-foreground bg-card max-w-md border-2 p-8">
          <p className="font-mono text-[10px] font-semibold tracking-[0.2em] uppercase">
            Start here
          </p>
          <h1 className="mt-2 text-4xl font-bold tracking-[-0.05em]">
            Give Knock a project.
          </h1>
          <p className="text-muted-foreground mt-3 text-sm leading-6">
            Add the product you promote. Knock will crawl its website before the
            first daily sync.
          </p>
          <Button
            onClick={() => setCreateOpen(true)}
            className="hard-shadow-sm border-foreground bg-accent text-accent-foreground mt-6 border-2"
          >
            <Plus /> Add project
          </Button>
        </div>
      </div>
    );
  }

  const readyCount = queue?.length ?? 0;
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-8">
      <header className="border-foreground flex flex-col gap-5 border-b-2 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-muted-foreground font-mono text-[10px] font-semibold tracking-[0.2em] uppercase">
            Product Hunt / Today
          </p>
          <h1 className="mt-1 text-4xl font-bold tracking-[-0.055em] md:text-5xl">
            Daily launches
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            {currentProject.name} <span aria-hidden="true">/</span> PKT pipeline
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={sync}
            disabled={syncing}
            className="border-foreground border-2"
          >
            {syncing ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <RefreshCw />
            )}
            Sync now
          </Button>
          <Button
            onClick={() => setReviewOpen(true)}
            disabled={readyCount === 0}
            className="hard-shadow border-foreground bg-accent text-accent-foreground hover:bg-accent/80 border-2 px-5"
          >
            <Play className="fill-current" /> Review queue
            <span className="ml-1 border border-current px-1.5 font-mono text-[10px]">
              {readyCount}
            </span>
          </Button>
        </div>
      </header>

      {currentProject.contextStatus !== "ready" ? (
        <div className="border-foreground bg-card mt-5 flex items-start gap-3 border-2 p-4">
          {currentProject.contextStatus === "building" ? (
            <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin" />
          ) : (
            <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" />
          )}
          <div>
            <p className="text-sm font-semibold">
              {currentProject.contextStatus === "building"
                ? "Building brand context"
                : "Brand context failed"}
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {currentProject.contextError ??
                "Firecrawl and DeepSeek are processing the project website."}
            </p>
          </div>
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

      <section className="mt-6" aria-label="Today's launches">
        {launches === undefined ? (
          <LaunchListLoading />
        ) : launches.length ? (
          <div className="border-foreground border-t-2">
            {launches.map(({ projectLaunch, launch, draft }) => (
              <article
                key={projectLaunch._id}
                className="border-foreground bg-card hover:bg-muted grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 border-b-2 px-3 py-3.5 transition-colors md:grid-cols-[3rem_minmax(0,1fr)_9rem_2rem] md:px-4"
              >
                <div className="border-foreground bg-background grid size-9 place-items-center border-2 text-sm font-bold uppercase md:size-10">
                  {launch.name.slice(0, 1)}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-sm font-bold md:text-base">
                      {launch.name}
                    </h2>
                    {projectLaunch.contactEmail ? (
                      <span className="text-muted-foreground hidden truncate font-mono text-[10px] xl:inline">
                        {projectLaunch.contactEmail}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground mt-0.5 truncate text-xs md:text-sm">
                    {launch.tagline}
                  </p>
                  {projectLaunch.status === "failed" &&
                  projectLaunch.failure ? (
                    <p className="text-destructive mt-1 truncate text-xs">
                      {projectLaunch.failure}
                    </p>
                  ) : draft?.status === "skipped" ? (
                    <p className="text-muted-foreground mt-1 truncate text-xs">
                      Skipped draft retained
                    </p>
                  ) : null}
                </div>
                <StatusBadge status={projectLaunch.status} />
                {projectLaunch.status === "failed" ? (
                  <button
                    type="button"
                    onClick={() =>
                      void retryLaunch({
                        projectLaunchId: projectLaunch._id,
                      }).catch((caught) =>
                        setError(
                          caught instanceof Error
                            ? caught.message
                            : "Retry failed",
                        ),
                      )
                    }
                    aria-label={`Retry ${launch.name}`}
                    className="hover:border-foreground hover:bg-accent hidden size-8 place-items-center border border-transparent md:grid"
                  >
                    <RefreshCw className="size-4" />
                  </button>
                ) : (
                  <a
                    href={launch.productHuntUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${launch.name} on Product Hunt`}
                    className="hover:border-foreground hover:bg-accent hidden size-8 place-items-center border border-transparent md:grid"
                  >
                    <ArrowUpRight className="size-4" />
                  </a>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="border-foreground border-2 border-dashed p-10 text-center">
            <p className="text-lg font-bold">No retained launches yet</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Run a sync or wait for the 2:45 PM PKT schedule.
            </p>
            <Button
              variant="outline"
              onClick={sync}
              disabled={syncing}
              className="border-foreground mt-5 border-2"
            >
              <RefreshCw /> Sync now
            </Button>
          </div>
        )}
      </section>

      {currentProjectId ? (
        <ReviewQueue
          projectId={currentProjectId}
          open={reviewOpen}
          onOpenChange={setReviewOpen}
        />
      ) : null}
    </div>
  );
}

function TodayLoading() {
  return (
    <div className="mx-auto max-w-7xl p-8">
      <Skeleton className="h-5 w-36 rounded-none" />
      <Skeleton className="mt-3 h-12 w-80 rounded-none" />
      <LaunchListLoading />
    </div>
  );
}

function LaunchListLoading() {
  return (
    <div className="mt-6 grid gap-2">
      {Array.from({ length: 5 }, (_, index) => (
        <Skeleton
          key={index}
          className="border-foreground/20 h-16 w-full rounded-none border"
        />
      ))}
    </div>
  );
}
