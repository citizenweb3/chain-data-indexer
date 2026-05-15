"use client";

import type { FC, ReactNode } from "react";
import { cn } from "@/utils/cn";

interface TabGroupProps {
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}

export const TabGroup: FC<TabGroupProps> = ({
  children,
  className,
  ariaLabel,
}) => (
  <div
    role="tablist"
    aria-label={ariaLabel}
    className={cn(
      "inline-flex items-center gap-1 rounded-md border border-bgSt bg-table_row p-1",
      className,
    )}
  >
    {children}
  </div>
);

interface TabProps {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}

export const Tab: FC<TabProps> = ({ active, onClick, children, className }) => (
  <button
    type="button"
    role="tab"
    aria-selected={active}
    onClick={onClick}
    className={cn(
      "rounded-sm px-3 py-1.5 font-sfpro text-sm tracking-wide transition-colors",
      active
        ? "bg-bgHover text-highlight"
        : "text-white/70 hover:text-highlight",
      className,
    )}
  >
    {children}
  </button>
);
