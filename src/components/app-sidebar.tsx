"use client";

import { UserButton } from "@clerk/nextjs";
import {
  ChevronDown,
  FolderCog,
  LoaderCircle,
  Menu,
  Plus,
  Settings,
  Target,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { useCurrentProject } from "@/components/project-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const navigation = [
  { href: "/today", label: "Today", icon: Target },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

function SidebarContents({ close }: { close?: () => void }) {
  const pathname = usePathname();
  const {
    projects,
    currentProject,
    selectProject,
    hasMoreProjects,
    loadingMoreProjects,
    loadMoreProjects,
    setCreateOpen,
  } = useCurrentProject();

  return (
    <div className="bg-sidebar flex h-full flex-col">
      <div className="border-sidebar-border border-b-2 p-3">
        <Link
          href="/today"
          onClick={close}
          className="mb-4 flex items-center gap-2 px-1"
        >
          <span className="border-foreground bg-accent text-accent-foreground grid size-7 place-items-center border-2 font-mono text-sm font-bold">
            K
          </span>
          <span className="text-lg font-bold tracking-[-0.04em]">KNOCK</span>
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                className="hard-shadow-sm border-foreground bg-card h-auto w-full justify-between border-2 px-3 py-2 text-left"
              />
            }
          >
            <span className="min-w-0">
              <span className="text-muted-foreground block font-mono text-[9px] font-semibold tracking-wider uppercase">
                Current project
              </span>
              <span className="block truncate text-sm font-bold">
                {currentProject?.name ?? "No project"}
              </span>
            </span>
            <ChevronDown className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="border-foreground border-2 shadow-[3px_3px_0_var(--foreground)] ring-0">
            <DropdownMenuLabel>Projects</DropdownMenuLabel>
            {projects?.map((project) => (
              <DropdownMenuItem
                key={project._id}
                onClick={() => selectProject(project._id)}
              >
                <span className="border-foreground bg-accent size-2 border" />
                <span className="truncate">{project.name}</span>
              </DropdownMenuItem>
            ))}
            {hasMoreProjects ? (
              <DropdownMenuItem
                disabled={loadingMoreProjects}
                onClick={loadMoreProjects}
              >
                {loadingMoreProjects ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Plus />
                )}
                Load more projects
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator className="bg-foreground" />
            <DropdownMenuItem onClick={() => setCreateOpen(true)}>
              <Plus /> Add project
            </DropdownMenuItem>
            <DropdownMenuItem
              render={<Link href="/settings" onClick={close} />}
            >
              <FolderCog /> Project management
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <nav className="grid gap-1 p-3" aria-label="Main navigation">
        {navigation.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={close}
              className={cn(
                "flex items-center gap-2 border-2 px-3 py-2 text-sm font-semibold",
                active
                  ? "border-foreground bg-accent text-accent-foreground shadow-[2px_2px_0_var(--foreground)]"
                  : "hover:border-foreground hover:bg-card border-transparent",
              )}
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-sidebar-border mt-auto flex items-center gap-3 border-t-2 p-4">
        <UserButton />
        <span className="font-mono text-[10px] font-semibold tracking-widest uppercase">
          Private workspace
        </span>
      </div>
    </div>
  );
}

export function AppSidebar() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <aside className="border-sidebar-border fixed inset-y-0 left-0 hidden w-64 border-r-2 lg:block">
        <SidebarContents />
      </aside>
      <header className="border-foreground bg-background sticky top-0 z-30 flex h-14 items-center justify-between border-b-2 px-4 lg:hidden">
        <span className="text-lg font-bold tracking-[-0.04em]">KNOCK</span>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
        >
          <Menu />
        </Button>
      </header>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          aria-label="Navigation"
          side="left"
          className="border-foreground w-[290px] border-r-2 p-0 shadow-none"
          showCloseButton={false}
        >
          <SidebarContents close={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}
