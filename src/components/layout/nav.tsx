"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/transfers", label: "Transfers" },
  { href: "/docs", label: "API Docs" },
] as const;

const isActive = (pathname: string, href: string): boolean => {
  if (href === "/dashboard") {
    return pathname === "/dashboard" || pathname.startsWith("/channels");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
};

export default function Nav() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-bgSt bg-background">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-6 px-6 py-3">
        <Link
          href="/dashboard"
          className="font-handjet text-xl tracking-wide text-highlight"
        >
          IBC Indexer
        </Link>
        <ul className="flex items-center gap-1 font-sfpro text-sm">
          {LINKS.map((link) => {
            const active = isActive(pathname, link.href);
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className={
                    active
                      ? "rounded-md bg-bgSt px-3 py-1.5 text-white"
                      : "rounded-md px-3 py-1.5 text-white/60 hover:bg-bgHover hover:text-white"
                  }
                  aria-current={active ? "page" : undefined}
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
