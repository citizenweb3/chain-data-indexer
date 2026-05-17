import type { FC, ReactNode } from "react";
import { cn } from "@/utils/cn";

interface SubtitleProps {
  children: ReactNode;
  className?: string;
}

const Subtitle: FC<SubtitleProps> = ({ children, className }) => (
  <h2
    className={cn(
      "font-sfpro text-xl uppercase tracking-wide text-white",
      className,
    )}
  >
    {children}
  </h2>
);

export default Subtitle;
