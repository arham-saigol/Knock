"use client";

import { useMutation, useQuery } from "convex/react";
import {
  ArrowRight,
  ExternalLink,
  LoaderCircle,
  Send,
  SquareArrowOutUpRight,
} from "lucide-react";
import { startTransition, useEffect, useRef, useState } from "react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function ReviewQueue({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: Id<"projects">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queue = useQuery(api.launches.reviewQueue, { projectId });
  const updateDraft = useMutation(api.launches.updateDraft);
  const skipDraft = useMutation(api.launches.skip);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const active =
    queue?.items.filter((item) => item.launch && !hidden.has(item.draft._id)) ??
    [];
  const current = active[0];
  const [edits, setEdits] = useState<
    Record<string, { subject: string; body: string; version: number }>
  >({});
  const [acknowledged, setAcknowledged] = useState<
    Record<string, { subject: string; body: string; version: number }>
  >({});
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
    "saved",
  );
  const [saveInFlight, setSaveInFlight] = useState(false);
  const editRevision = useRef(0);
  const [busy, setBusy] = useState<"skip" | "send">();
  const [error, setError] = useState("");

  const storedEdit = current ? edits[current.draft._id] : undefined;
  const hasVersionConflict = Boolean(
    current && storedEdit && current.draft.version > storedEdit.version,
  );
  const currentEdit = hasVersionConflict ? undefined : storedEdit;
  const currentDraftId = current?.draft._id;
  const currentDraftVersion = current
    ? Math.max(current.draft.version, currentEdit?.version ?? 0)
    : undefined;
  const subject = currentEdit?.subject ?? current?.draft.subject ?? "";
  const body = currentEdit?.body ?? current?.draft.body ?? "";
  const editedSubject = currentEdit?.subject;
  const editedBody = currentEdit?.body;
  const currentAcknowledged = currentDraftId
    ? acknowledged[currentDraftId]
    : undefined;
  const isSaved =
    !saveInFlight &&
    (!currentEdit ||
      (currentAcknowledged &&
        currentAcknowledged.version === currentDraftVersion &&
        currentAcknowledged.subject === subject &&
        currentAcknowledged.body === body));

  useEffect(() => {
    if (
      !currentDraftId ||
      currentDraftVersion === undefined ||
      editedSubject === undefined ||
      editedBody === undefined
    )
      return;
    if (saveInFlight || saveState === "error") return;
    const saved = acknowledged[currentDraftId];
    if (
      saved?.version === currentDraftVersion &&
      saved.subject === editedSubject &&
      saved.body === editedBody
    )
      return;
    const timeout = window.setTimeout(() => {
      const revision = editRevision.current;
      setSaveInFlight(true);
      void updateDraft({
        draftId: currentDraftId,
        expectedVersion: currentDraftVersion,
        subject: editedSubject,
        body: editedBody,
      })
        .then((savedDraft) => {
          setEdits((previous) => {
            const edit = previous[currentDraftId];
            return edit
              ? {
                  ...previous,
                  [currentDraftId]:
                    editRevision.current === revision
                      ? savedDraft
                      : { ...edit, version: savedDraft.version },
                }
              : previous;
          });
          setAcknowledged((previous) => ({
            ...previous,
            [currentDraftId]: savedDraft,
          }));
          setSaveState("saved");
        })
        .catch(() => {
          if (editRevision.current === revision) setSaveState("error");
        })
        .finally(() => setSaveInFlight(false));
    }, 650);
    return () => window.clearTimeout(timeout);
  }, [
    acknowledged,
    currentDraftId,
    currentDraftVersion,
    editedBody,
    editedSubject,
    saveInFlight,
    saveState,
    updateDraft,
  ]);

  function editSubject(value: string) {
    if (!current) return;
    editRevision.current += 1;
    setSaveState("saving");
    setEdits((previous) => ({
      ...previous,
      [current.draft._id]: {
        subject: value,
        body,
        version: currentEdit?.version ?? current.draft.version,
      },
    }));
  }

  function editBody(value: string) {
    if (!current) return;
    editRevision.current += 1;
    setSaveState("saving");
    setEdits((previous) => ({
      ...previous,
      [current.draft._id]: {
        subject,
        body: value,
        version: currentEdit?.version ?? current.draft.version,
      },
    }));
  }

  function advance(draftId: string) {
    startTransition(() => {
      setHidden((previous) => new Set(previous).add(draftId));
      setSaveState("saved");
    });
  }

  async function skip() {
    if (!current || busy || !isSaved) return;
    setBusy("skip");
    setError("");
    try {
      await skipDraft({ draftId: current.draft._id });
      advance(current.draft._id);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to skip draft",
      );
    } finally {
      setBusy(undefined);
    }
  }

  async function send() {
    if (!current || busy || !isSaved) return;
    setBusy("send");
    setError("");
    try {
      const response = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: current.draft._id }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Unable to send email");
      advance(current.draft._id);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to send email",
      );
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isSaved && saveState !== "error") return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="bg-background inset-0 top-0 left-0 h-dvh max-h-none w-screen max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-none border-0 p-0 ring-0 sm:max-w-none">
        {current?.launch ? (
          <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-5 py-5 md:px-10 md:py-8">
            <DialogHeader className="border-foreground border-b-2 pr-12 pb-5">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <DialogTitle className="mr-auto text-2xl font-bold tracking-[-0.04em] md:text-3xl">
                  {current.launch.name}
                </DialogTitle>
                <a
                  href={current.launch.productHuntUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="border-foreground grid size-8 place-items-center border-2 bg-[#ff6154] font-bold text-white"
                  aria-label="Open on Product Hunt"
                >
                  P
                </a>
                {current.launch.websiteUrl ? (
                  <a
                    href={current.launch.websiteUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="border-foreground hover:bg-accent grid size-8 place-items-center border-2"
                    aria-label="Open website"
                  >
                    <SquareArrowOutUpRight className="size-4" />
                  </a>
                ) : null}
              </div>
              <DialogDescription className="text-foreground font-mono text-xs">
                {current.projectLaunch?.contactSourceUrl ? (
                  <a
                    href={current.projectLaunch.contactSourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-4"
                    title="Open the public email source"
                  >
                    {current.projectLaunch.contactEmail}
                  </a>
                ) : (
                  current.projectLaunch?.contactEmail
                )}
              </DialogDescription>
            </DialogHeader>

            <div className="grid flex-1 content-start gap-5 py-6">
              <div className="grid gap-1.5">
                <Label
                  htmlFor="review-subject"
                  className="font-mono text-[10px] font-semibold tracking-widest uppercase"
                >
                  Subject
                </Label>
                <Input
                  id="review-subject"
                  value={subject}
                  onChange={(event) => editSubject(event.target.value)}
                  className="border-foreground bg-card h-11 border-2 text-base font-semibold"
                  maxLength={120}
                />
              </div>
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between">
                  <Label
                    htmlFor="review-body"
                    className="font-mono text-[10px] font-semibold tracking-widest uppercase"
                  >
                    Email body
                  </Label>
                  <span className="text-muted-foreground font-mono text-[10px] uppercase">
                    {isSaved
                      ? "Saved"
                      : saveState === "error"
                        ? "Save failed"
                        : "Saving"}
                  </span>
                </div>
                <Textarea
                  id="review-body"
                  value={body}
                  onChange={(event) => editBody(event.target.value)}
                  className="border-foreground bg-card min-h-[48dvh] resize-none border-2 p-4 text-[15px] leading-7 md:min-h-[52dvh]"
                  maxLength={5_000}
                />
              </div>
            </div>

            {error ? (
              <p
                role="alert"
                className="border-destructive text-destructive mb-4 border-l-4 pl-3 text-sm"
              >
                {error}
              </p>
            ) : null}
            <div className="border-foreground bg-background sticky bottom-0 -mx-5 flex items-center justify-between gap-4 border-t-2 px-5 py-4 md:-mx-10 md:px-10">
              <span className="text-muted-foreground hidden font-mono text-[10px] uppercase sm:block">
                {queue?.hasMore ? "50+" : active.length} left in queue
              </span>
              <div className="ml-auto flex gap-3">
                <Button
                  variant="outline"
                  size="lg"
                  onClick={skip}
                  disabled={Boolean(busy) || !isSaved}
                  className="border-foreground border-2"
                >
                  {busy === "skip" ? (
                    <LoaderCircle className="animate-spin" />
                  ) : null}
                  Skip
                </Button>
                <Button
                  size="lg"
                  onClick={send}
                  disabled={
                    Boolean(busy) || !isSaved || !subject.trim() || !body.trim()
                  }
                  className="hard-shadow border-foreground bg-accent text-accent-foreground hover:bg-accent/80 border-2"
                >
                  {busy === "send" ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Send />
                  )}
                  Send
                  <ArrowRight />
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid min-h-dvh place-items-center p-6">
            <div className="border-foreground bg-card hard-shadow max-w-sm border-2 p-8 text-center">
              <div className="border-foreground bg-accent mx-auto mb-5 grid size-12 place-items-center border-2">
                <ExternalLink className="size-5" />
              </div>
              <DialogTitle className="text-2xl font-bold">
                Queue clear
              </DialogTitle>
              <DialogDescription className="mt-2">
                No ready drafts remain for this project.
              </DialogDescription>
              <Button
                onClick={() => onOpenChange(false)}
                className="border-foreground mt-6 border"
              >
                Return to today
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
