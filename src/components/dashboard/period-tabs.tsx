"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { FC } from "react";
import { Tab, TabGroup } from "@/components/ui/tabs";
import { useNavigationLoading } from "@/components/layout/navigation-loading";

export type Period = "24h" | "7d" | "30d";

const PERIODS: { value: Period; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
];

interface PeriodTabsProps {
  defaultValue?: Period;
}

const PeriodTabs: FC<PeriodTabsProps> = ({ defaultValue = "24h" }) => {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { startNavigation } = useNavigationLoading();
  const current = (sp.get("period") as Period | null) ?? defaultValue;

  const onSelect = (value: Period) => {
    if (value === current) return;
    const next = new URLSearchParams(sp.toString());
    next.set("period", value);
    next.delete("p");
    startNavigation(() => {
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    });
  };

  return (
    <TabGroup ariaLabel="Time period">
      {PERIODS.map((p) => (
        <Tab
          key={p.value}
          active={current === p.value}
          onClick={() => onSelect(p.value)}
        >
          {p.label}
        </Tab>
      ))}
    </TabGroup>
  );
};

export default PeriodTabs;
