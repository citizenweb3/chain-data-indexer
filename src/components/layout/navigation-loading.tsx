"use client";

import {
  createContext,
  useContext,
  useTransition,
  type ReactNode,
} from "react";

interface NavLoadingCtx {
  pending: boolean;
  startNavigation: (cb: () => void) => void;
}

const Ctx = createContext<NavLoadingCtx | null>(null);

export function NavigationLoadingProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Ctx.Provider
      value={{
        pending,
        startNavigation: (cb) => startTransition(cb),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useNavigationLoading(): NavLoadingCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    return {
      pending: false,
      startNavigation: (cb) => cb(),
    };
  }
  return ctx;
}
