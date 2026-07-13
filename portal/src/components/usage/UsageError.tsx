"use client";

import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/common/ErrorState";

export function UsageError() {
  const router = useRouter();
  return (
    <ErrorState
      title="Couldn't load usage"
      body={
        <>
          If the <code>usage_logs</code> table isn&apos;t created yet, apply migration{" "}
          <code>0013_usage_logs.sql</code>.
        </>
      }
      onRetry={() => router.refresh()}
    />
  );
}
