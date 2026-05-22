"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ChainName } from "@/lib/chains";

type TabKey = "dashboard" | "assets" | "transfers";

const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: "dashboard", label: "Dashboard" },
  { key: "assets", label: "Assets" },
  { key: "transfers", label: "Transfers" },
];

const isActive = (pathname: string, chain: ChainName, key: TabKey): boolean => {
  const base = `/${chain}/${key}`;
  if (key === "dashboard") {
    return pathname === base || pathname.startsWith(`/${chain}/channels`);
  }
  return pathname === base || pathname.startsWith(`${base}/`);
};

interface Props {
  chain: ChainName;
}

export default function ChainTabs({ chain }: Props) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Section navigation"
      className="border-bgSt -mt-1 flex items-center gap-6 border-b"
    >
      {TABS.map((t) => {
        const active = isActive(pathname, chain, t.key);
        return (
          <Link
            key={t.key}
            href={`/${chain}/${t.key}`}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "font-sfpro text-highlight border-highlight -mb-px border-b-2 px-1 py-2.5 text-sm"
                : "font-sfpro -mb-px border-b-2 border-transparent px-1 py-2.5 text-sm text-white/55 hover:text-white"
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
