import type { FC } from "react";
import Spinner from "@/components/ui/spinner";
import { cn } from "@/utils/cn";

interface LoadingBlockProps {
  height?: string;
  label?: string;
  className?: string;
  bordered?: boolean;
}

const LoadingBlock: FC<LoadingBlockProps> = ({
  height = "h-32",
  label,
  className,
  bordered = true,
}) => (
  <div
    role="status"
    aria-label={label ?? "Loading"}
    className={cn(
      "flex w-full flex-col items-center justify-center gap-2",
      bordered && "border-bgSt bg-table_row border",
      height,
      className,
    )}
  >
    <Spinner size="md" />
    {label && (
      <span className="font-sfpro text-xs uppercase tracking-wide text-white/40">
        {label}
      </span>
    )}
  </div>
);

export default LoadingBlock;
