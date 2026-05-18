import type { FC } from "react";
import { cn } from "@/utils/cn";

type Size = "sm" | "md" | "lg";

interface SpinnerProps {
  size?: Size;
  className?: string;
}

const sizeClass: Record<Size, string> = {
  sm: "h-4 w-4 border-2",
  md: "h-8 w-8 border-2",
  lg: "h-12 w-12 border-[3px]",
};

const Spinner: FC<SpinnerProps> = ({ size = "md", className }) => (
  <div
    role="status"
    aria-label="Loading"
    className={cn(
      "inline-block animate-spin rounded-full border-white/15 border-t-highlight",
      sizeClass[size],
      className,
    )}
  />
);

export default Spinner;
