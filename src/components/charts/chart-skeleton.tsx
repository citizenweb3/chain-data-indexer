import type { FC } from "react";
import type { ChartVariant } from "@/components/charts/chart-config";
import Spinner from "@/components/ui/spinner";
import { cn } from "@/utils/cn";

interface ChartSkeletonProps {
  variant?: ChartVariant;
  className?: string;
}

const ChartSkeleton: FC<ChartSkeletonProps> = ({
  variant = "full",
  className,
}) => (
  <div
    role="status"
    aria-label="Loading chart"
    className={cn(
      "flex w-full items-center justify-center",
      variant === "full" ? "h-72" : "h-12",
      className,
    )}
  >
    <Spinner size={variant === "full" ? "md" : "sm"} />
  </div>
);

export default ChartSkeleton;
