"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { MOBILE_BOTTOM_NAV, type NavCounts } from "./nav";

export function MobileBottomNav({ counts }: { counts: NavCounts }) {
  const pathname = usePathname();

  return (
    <nav
      className="flex shrink-0 border-t border-line bg-surface px-1.5 pt-1.5 lg:hidden"
      style={{ paddingBottom: "calc(6px + env(safe-area-inset-bottom))" }}
    >
      {MOBILE_BOTTOM_NAV.map((item) => {
        const active = item.isActive(pathname);
        const count = item.countKey ? counts[item.countKey] : undefined;
        return (
          <Link
            key={item.href}
            href={item.href ?? "#"}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex flex-1 flex-col items-center gap-1 rounded-md px-1 py-1.5 text-[10.5px] font-medium transition-colors",
              active ? "text-brand" : "text-ink-3"
            )}
          >
            <item.icon className="h-[21px] w-[21px]" aria-hidden />
            {item.label}
            {count ? (
              <span className="absolute right-[18%] top-0 min-w-[15px] rounded-pill bg-attention px-1 text-center font-mono text-[9px] font-bold leading-[15px] text-on-attention">
                {count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
