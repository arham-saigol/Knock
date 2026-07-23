"use client";

import { usePaginatedQuery, useQuery } from "convex/react";
import { createContext, use, useEffect, useState, type ReactNode } from "react";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";

type ProjectContextValue = {
  projects: Doc<"projects">[] | undefined;
  currentProject: Doc<"projects"> | undefined;
  currentProjectId: Id<"projects"> | undefined;
  selectProject: (projectId: Id<"projects">) => void;
  hasMoreProjects: boolean;
  loadingMoreProjects: boolean;
  loadMoreProjects: () => void;
  createOpen: boolean;
  setCreateOpen: (open: boolean) => void;
};

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [selectedId, setSelectedId] = useState<Id<"projects"> | undefined>(
    () => {
      if (typeof window === "undefined") return undefined;
      return (
        (window.localStorage.getItem(
          "knock.currentProject",
        ) as Id<"projects"> | null) ?? undefined
      );
    },
  );
  const {
    results: projectPage,
    status: projectPaginationStatus,
    loadMore,
  } = usePaginatedQuery(api.projects.list, {}, { initialNumItems: 20 });
  const selectedProject = useQuery(
    api.projects.selected,
    selectedId ? { projectId: selectedId } : "skip",
  );
  const [createOpen, setCreateOpen] = useState(false);

  function selectProject(projectId: Id<"projects">) {
    setSelectedId(projectId);
    window.localStorage.setItem("knock.currentProject", projectId);
  }

  const pageSelected = projectPage.find(
    (project) => project._id === selectedId,
  );
  const resolvedSelected = pageSelected ?? selectedProject;
  const projects =
    projectPaginationStatus === "LoadingFirstPage"
      ? undefined
      : resolvedSelected && !pageSelected
        ? [resolvedSelected, ...projectPage]
        : projectPage;
  const currentProject = selectedId
    ? resolvedSelected === undefined
      ? undefined
      : (resolvedSelected ?? projects?.[0])
    : projects?.[0];
  const hasMoreProjects =
    projectPaginationStatus === "CanLoadMore" ||
    projectPaginationStatus === "LoadingMore";

  useEffect(() => {
    if (currentProject) {
      window.localStorage.setItem("knock.currentProject", currentProject._id);
    }
  }, [currentProject]);

  return (
    <ProjectContext
      value={{
        projects,
        currentProject,
        currentProjectId: currentProject?._id,
        selectProject,
        hasMoreProjects,
        loadingMoreProjects: projectPaginationStatus === "LoadingMore",
        loadMoreProjects: () => {
          if (projectPaginationStatus === "CanLoadMore") loadMore(20);
        },
        createOpen,
        setCreateOpen,
      }}
    >
      {children}
    </ProjectContext>
  );
}

export function useCurrentProject() {
  const value = use(ProjectContext);
  if (!value)
    throw new Error("useCurrentProject must be used inside ProjectProvider");
  return value;
}
