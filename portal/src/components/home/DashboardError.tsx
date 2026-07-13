"use client";

import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/common/ErrorState";

export function DashboardError() {
  const router = useRouter();
  return (
    <ErrorState
      title="Couldn't load your overview"
      onRetry={() => router.refresh()}
    />
  );
}
