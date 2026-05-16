"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { FC } from "react";
import { cn } from "@/utils/cn";

export type SortDirection = "asc" | "desc";

interface TableSortItemsProps {
  label: string;
  field?: string;
  defaultSelected?: boolean;
  className?: string;
}

const TableSortItems: FC<TableSortItemsProps> = ({
  label,
  field,
  defaultSelected = false,
  className,
}) => {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const currentSort = sp.get("sort");
  const currentOrder = (sp.get("order") ?? "asc") as SortDirection;
  const isActive =
    !!field && (currentSort === field || (!currentSort && defaultSelected));

  const onSort = () => {
    if (!field) return;
    const next = new URLSearchParams(sp.toString());
    next.set("sort", field);
    const flipDesc =
      (currentSort === field && currentOrder === "asc") ||
      (!currentSort && defaultSelected);
    next.set("order", flipDesc ? "desc" : "asc");
    next.delete("p");
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const arrow = !field
    ? null
    : isActive
      ? currentOrder === "asc"
        ? "▲"
        : "▼"
      : "↕";

  return (
    <div
      className={cn(
        "group flex flex-row items-center justify-center gap-1 py-3",
        field && "cursor-pointer select-none",
        className,
      )}
      onClick={onSort}
    >
      {arrow && (
        <span
          className={cn(
            "font-handjet text-xs",
            isActive ? "text-highlight" : "text-white/50",
          )}
        >
          {arrow}
        </span>
      )}
      <span
        className={cn(
          "text-nowrap font-sfpro text-sm font-normal",
          isActive && "text-highlight",
        )}
      >
        {label}
      </span>
    </div>
  );
};

export default TableSortItems;
