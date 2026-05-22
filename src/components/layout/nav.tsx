"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CHAIN_NAMES,
  CHAIN_DISPLAY_NAMES,
  type ChainName,
  isChainName,
} from "@/lib/chains";

const DEFAULT_CHAIN: ChainName = "cosmoshub";

type PageKey = "dashboard" | "assets" | "transfers";

const PAGES: ReadonlyArray<{ key: PageKey; label: string }> = [
  { key: "dashboard", label: "Dashboard" },
  { key: "assets", label: "Assets" },
  { key: "transfers", label: "Transfers" },
];

const DOCS_HREF = "/docs";

const extractChain = (pathname: string): ChainName | null => {
  const seg = pathname.split("/", 2)[1] ?? "";
  return isChainName(seg) ? seg : null;
};

const isDocsRoute = (path: string): boolean =>
  path === DOCS_HREF || path.startsWith(`${DOCS_HREF}/`);

const isPageActive = (pathname: string, chain: ChainName, key: PageKey): boolean => {
  const base = `/${chain}/${key}`;
  if (key === "dashboard") {
    return pathname === base || pathname.startsWith(`/${chain}/channels`);
  }
  return pathname === base || pathname.startsWith(`${base}/`);
};

const isDocsActive = (pathname: string): boolean => isDocsRoute(pathname);

export default function Nav() {
  const pathname = usePathname();
  const activeChain = extractChain(pathname) ?? DEFAULT_CHAIN;
  const onDocs = isDocsRoute(pathname);

  return (
    <nav className="border-b border-bgSt bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-6 px-6 py-3">
        <ul
          role="tablist"
          aria-label="Chain"
          className="flex items-center gap-1 border border-bgSt p-0.5"
        >
          {CHAIN_NAMES.map((name) => {
            const active = name === activeChain && !onDocs;
            const className = active
              ? "px-3 py-1 font-handjet text-sm uppercase tracking-wide bg-bgSt text-highlight"
              : "px-3 py-1 font-handjet text-sm uppercase tracking-wide text-white/60 hover:bg-bgHover hover:text-white";
            const href = `/${name}/dashboard`;
            return (
              <li key={name}>
                {onDocs ? (
                  <a
                    href={href}
                    role="tab"
                    aria-selected={active}
                    className={className}
                  >
                    {CHAIN_DISPLAY_NAMES[name]}
                  </a>
                ) : (
                  <Link
                    href={href}
                    role="tab"
                    aria-selected={active}
                    className={className}
                  >
                    {CHAIN_DISPLAY_NAMES[name]}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>

        <ul className="flex items-center gap-1 font-sfpro text-sm">
          {PAGES.map((p) => {
            const active = !onDocs && isPageActive(pathname, activeChain, p.key);
            const className = active
              ? "rounded-md bg-bgSt px-3 py-1.5 text-highlight"
              : "rounded-md px-3 py-1.5 text-white/60 hover:bg-bgHover hover:text-white";
            const href = `/${activeChain}/${p.key}`;
            return (
              <li key={p.key}>
                {onDocs ? (
                  <a
                    href={href}
                    className={className}
                    aria-current={active ? "page" : undefined}
                  >
                    {p.label}
                  </a>
                ) : (
                  <Link
                    href={href}
                    className={className}
                    aria-current={active ? "page" : undefined}
                  >
                    {p.label}
                  </Link>
                )}
              </li>
            );
          })}
          <li key={DOCS_HREF}>
            <a
              href={DOCS_HREF}
              className={
                isDocsActive(pathname)
                  ? "rounded-md bg-bgSt px-3 py-1.5 text-highlight"
                  : "rounded-md px-3 py-1.5 text-white/60 hover:bg-bgHover hover:text-white"
              }
              aria-current={isDocsActive(pathname) ? "page" : undefined}
            >
              API Docs
            </a>
          </li>
        </ul>
      </div>
    </nav>
  );
}
