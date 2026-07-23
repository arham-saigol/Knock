import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const statusLabels = {
  processing: "Processing",
  ready: "Ready",
  no_email: "No email",
  sent: "Sent",
  skipped: "Skipped",
  failed: "Failed",
  filtered: "Filtered",
} as const;

export function StatusBadge({ status }: { status: keyof typeof statusLabels }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-none border px-2 font-mono text-[10px] font-semibold tracking-wide uppercase",
        status === "ready" && "bg-accent text-accent-foreground",
        status === "sent" && "bg-foreground text-background",
        status === "failed" && "border-destructive text-destructive",
        status === "processing" && "border-dashed",
      )}
    >
      {statusLabels[status]}
    </Badge>
  );
}
