"use client";

import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/common/ErrorState";

export function ActionItemsError() {
  const router = useRouter();
  return (
    <ErrorState
      title="Couldn't load your action items"
      body="This is a temporary issue on our end — your commitments are safe."
      onRetry={() => router.refresh()}
    />
  );
}
