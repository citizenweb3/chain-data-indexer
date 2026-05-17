"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/assets", label: "Assets" },
  { href: "/transfers", label: "Transfers" },
  { href: "/docs", label: "API Docs" },
] as const;

const isActive = (pathname: string, href: string): boolean => {
  if (href === "/dashboard") {
    return pathname === "/dashboard" || pathname.startsWith("/channels");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
};

const isDocsRoute = (path: string): boolean =>
  path === "/docs" || path.startsWith("/docs/");

export default function Nav() {
  const pathname = usePathname();
  const onDocs = isDocsRoute(pathname);

  return (
    <nav className="border-b border-bgSt bg-background">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-6 px-6 py-3">
        <ul className="flex items-center gap-1 font-sfpro text-sm">
          {LINKS.map((link) => {
            const active = isActive(pathname, link.href);
            const className = active
              ? "rounded-md bg-bgSt px-3 py-1.5 text-highlight"
              : "rounded-md px-3 py-1.5 text-white/60 hover:bg-bgHover hover:text-white";
            const ariaCurrent = active ? "page" : undefined;
            const useHardLink = onDocs || isDocsRoute(link.href);
            return (
              <li key={link.href}>
                {useHardLink ? (
                  <a
                    href={link.href}
                    className={className}
                    aria-current={ariaCurrent}
                  >
                    {link.label}
                  </a>
                ) : (
                  <Link
                    href={link.href}
                    className={className}
                    aria-current={ariaCurrent}
                  >
                    {link.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
