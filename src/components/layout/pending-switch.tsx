"use client";

import type { ReactNode } from "react";
import { useNavigationLoading } from "@/components/layout/navigation-loading";

interface PendingSwitchProps {
  children: ReactNode;
  fallback: ReactNode;
}

export default function PendingSwitch({
  children,
  fallback,
}: PendingSwitchProps) {
  const { pending } = useNavigationLoading();
  return <>{pending ? fallback : children}</>;
}
