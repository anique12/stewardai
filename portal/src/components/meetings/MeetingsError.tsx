"use client";

import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/common/ErrorState";

export function MeetingsError() {
  const router = useRouter();
  return (
    <ErrorState
      title="We couldn't reach your calendar"
      body="Steward lost its connection to Google Calendar. Your data is safe — this is a temporary sync error."
      onRetry={() => router.refresh()}
    />
  );
}
