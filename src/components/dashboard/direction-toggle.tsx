"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { FC } from "react";
import { Tab, TabGroup } from "@/components/ui/tabs";
import { useNavigationLoading } from "@/components/layout/navigation-loading";

export type Direction = "outgoing" | "incoming" | "both";

const DIRECTIONS: { value: Direction; label: string }[] = [
  { value: "outgoing", label: "Out" },
  { value: "incoming", label: "In" },
  { value: "both", label: "Both" },
];

interface DirectionToggleProps {
  defaultValue?: Direction;
}

const DirectionToggle: FC<DirectionToggleProps> = ({
  defaultValue = "both",
}) => {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { startNavigation } = useNavigationLoading();
  const current =
    (sp.get("direction") as Direction | null) ?? defaultValue;

  const onSelect = (value: Direction) => {
    if (value === current) return;
    const next = new URLSearchParams(sp.toString());
    next.set("direction", value);
    next.delete("p");
    startNavigation(() => {
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    });
  };

  return (
    <TabGroup ariaLabel="Direction">
      {DIRECTIONS.map((d) => (
        <Tab
          key={d.value}
          active={current === d.value}
          onClick={() => onSelect(d.value)}
        >
          {d.label}
        </Tab>
      ))}
    </TabGroup>
  );
};

export default DirectionToggle;
