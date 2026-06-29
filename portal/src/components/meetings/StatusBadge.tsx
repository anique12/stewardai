import { Badge } from "@/components/ui/badge";

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending:    { label: "Pending",     variant: "secondary" },
  joining:    { label: "Joining…",    variant: "default" },
  in_meeting: { label: "In meeting",  variant: "default" },
  done:       { label: "Done",        variant: "outline" },
  failed:     { label: "Failed",      variant: "destructive" },
};

export function StatusBadge({ status }: { status: string }) {
  const { label, variant } = STATUS_MAP[status] ?? { label: status, variant: "secondary" };
  return <Badge variant={variant}>{label}</Badge>;
}
