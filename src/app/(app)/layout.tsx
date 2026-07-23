import type { ReactNode } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { AuthenticatedShell } from "@/components/authenticated-shell";
import { CreateProjectDialog } from "@/components/create-project-dialog";
import { ProjectProvider } from "@/components/project-context";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthenticatedShell>
      <ProjectProvider>
        <AppSidebar />
        <main className="min-h-dvh lg:ml-64">{children}</main>
        <CreateProjectDialog />
      </ProjectProvider>
    </AuthenticatedShell>
  );
}
