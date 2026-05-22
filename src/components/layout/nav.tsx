"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ChainSwitcher from "@/components/layout/chain-switcher";

const COMBINED_HREF = "/";
const DOCS_HREF = "/docs";

const isDocsRoute = (path: string): boolean =>
  path === DOCS_HREF || path.startsWith(`${DOCS_HREF}/`);

const isCombinedActive = (pathname: string): boolean => pathname === "/";

const activeClass = "text-highlight font-sfpro text-sm px-2 py-1.5";
const inactiveClass =
  "text-white/70 hover:text-white font-sfpro text-sm px-2 py-1.5";

export default function Nav() {
  const pathname = usePathname();
  const onDocs = isDocsRoute(pathname);
  // /docs is outside the App Router page tree, so any link from it (or to it) must hard-navigate.
  const hardNav = onDocs;

  const renderLink = (
    href: string,
    label: string,
    active: boolean,
    forceHard = false,
  ) => {
    const className = active ? activeClass : inactiveClass;
    const ariaCurrent = active ? "page" : undefined;
    if (hardNav || forceHard) {
      return (
        <a href={href} className={className} aria-current={ariaCurrent}>
          {label}
        </a>
      );
    }
    return (
      <Link href={href} className={className} aria-current={ariaCurrent}>
        {label}
      </Link>
    );
  };

  return (
    <nav className="border-bgSt bg-background border-b">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-4 px-6 py-3">
        <Link
          href={COMBINED_HREF}
          className="font-handjet text-highlight mr-2 text-2xl tracking-wider uppercase"
        >
          IBC
        </Link>

        <div className="flex items-center gap-1">
          {renderLink(COMBINED_HREF, "Combined", isCombinedActive(pathname))}
        </div>

        <ChainSwitcher />

        <div className="ml-auto flex items-center gap-1">
          {renderLink(DOCS_HREF, "API Docs", isDocsRoute(pathname), true)}
        </div>
      </div>
    </nav>
  );
}
