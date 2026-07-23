"use client";

import { useMutation } from "convex/react";
import { LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";

import { api } from "../../convex/_generated/api";
import { useCurrentProject } from "@/components/project-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CreateProjectDialog() {
  const { createOpen, setCreateOpen, selectProject } = useCurrentProject();
  const createProject = useMutation(api.projects.create);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function changeOpen(open: boolean) {
    if (!open) setError("");
    setCreateOpen(open);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const projectId = await createProject({
        name: String(data.get("name") ?? ""),
        domain: String(data.get("domain") ?? ""),
        senderName: String(data.get("senderName") ?? ""),
        senderEmail: String(data.get("senderEmail") ?? ""),
      });
      selectProject(projectId);
      changeOpen(false);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to create project",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={createOpen} onOpenChange={changeOpen}>
      <DialogContent className="hard-shadow border-foreground border-2 ring-0 sm:max-w-lg">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <p className="font-mono text-[10px] font-semibold tracking-[0.18em] uppercase">
              New project
            </p>
            <DialogTitle className="text-xl font-bold tracking-tight">
              Add what you promote
            </DialogTitle>
            <DialogDescription>
              Knock crawls this site and builds editable brand context after
              creation.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <Field label="Project name" name="name" placeholder="Plurena" />
            <Field label="Domain" name="domain" placeholder="plurena.com" />
            <Field label="Sender name" name="senderName" placeholder="Arham" />
            <Field
              label="Sender email"
              name="senderEmail"
              type="email"
              placeholder="arham@plurena.com"
            />
          </div>
          {error ? (
            <p
              role="alert"
              className="border-destructive text-destructive border-l-4 pl-3 text-sm"
            >
              {error}
            </p>
          ) : null}
          <DialogFooter className="border-foreground bg-muted rounded-none">
            <Button
              type="button"
              variant="outline"
              onClick={() => changeOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="hard-shadow-sm border-foreground border"
            >
              {saving ? <LoaderCircle className="animate-spin" /> : null}
              Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  name,
  placeholder,
  type = "text",
}: {
  label: string;
  name: string;
  placeholder: string;
  type?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label
        htmlFor={name}
        className="font-mono text-[11px] font-semibold uppercase"
      >
        {label}
      </Label>
      <Input
        id={name}
        name={name}
        type={type}
        placeholder={placeholder}
        required
        className="border-foreground"
      />
    </div>
  );
}
