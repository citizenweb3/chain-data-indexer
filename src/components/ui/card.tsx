import type { FC, ReactNode } from "react";
import { cn } from "@/utils/cn";

interface CardProps {
  children: ReactNode;
  className?: string;
}

const Card: FC<CardProps> = ({ children, className }) => (
  <div
    className={cn(
      "rounded-md border border-bgSt bg-card p-5 shadow-md",
      className,
    )}
  >
    {children}
  </div>
);

export const CardHeader: FC<CardProps> = ({ children, className }) => (
  <div
    className={cn(
      "mb-2 font-sfpro text-xs uppercase tracking-wide text-white/60",
      className,
    )}
  >
    {children}
  </div>
);

export const CardValue: FC<CardProps> = ({ children, className }) => (
  <div
    className={cn(
      "font-handjet text-3xl tracking-wide text-highlight",
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
