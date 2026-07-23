"use client";

import { useQuery } from "convex/react";
import { createContext, use, useEffect, useState, type ReactNode } from "react";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";

type ProjectContextValue = {
  projects: Doc<"projects">[] | undefined;
  currentProject: Doc<"projects"> | undefined;
  currentProjectId: Id<"projects"> | undefined;
  selectProject: (projectId: Id<"projects">) => void;
  createOpen: boolean;
  setCreateOpen: (open: boolean) => void;
};

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const projects = useQuery(api.projects.list);
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
  const [createOpen, setCreateOpen] = useState(false);

  function selectProject(projectId: Id<"projects">) {
    setSelectedId(projectId);
    window.localStorage.setItem("knock.currentProject", projectId);
  }

  const currentProject =
    projects?.find((project) => project._id === selectedId) ?? projects?.[0];

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
