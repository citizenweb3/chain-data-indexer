import type { FC, ReactNode } from "react";
import { cn } from "@/utils/cn";

interface CardProps {
  children: ReactNode;
  className?: string;
}

const Card: FC<CardProps> = ({ children, className }) => (
  <div
    className={cn(
      "border border-bgSt bg-table_row p-6 transition-colors duration-75 hover:bg-bgHover",
      className,
    )}
  >
    {children}
  </div>
);

export const CardHeader: FC<CardProps> = ({ children, className }) => (
  <div
    className={cn(
      "mb-3 font-sfpro text-xs uppercase tracking-wide text-white/60",
      className,
    )}
  >
    {children}
  </div>
);

export const CardValue: FC<CardProps> = ({ children, className }) => (
  <div
    className={cn(
      "font-handjet text-4xl tracking-wide text-white",
      className,
    )}
  >
    {children}
  </div>
);

export const CardSubtext: FC<CardProps> = ({ children, className }) => (
  <div
    className={cn("mt-1 font-sfpro text-xs text-white/50", className)}
  >
    {children}
  </div>
);

export default Card;
