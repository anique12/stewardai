"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * App-scoped React Query provider. Mounted inside the `.steward-app`
 * ThemeProvider wrapper in `src/app/app/layout.tsx` so that every
 * client-side GET fetch under `/app/*` can be cached and deduped across
 * overlay opens / navigations. The landing page (`/`) does NOT get this
 * provider — it stays untouched.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
