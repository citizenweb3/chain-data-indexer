"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  CHAIN_NAMES,
  CHAIN_DISPLAY_NAMES,
  type ChainName,
  isChainName,
} from "@/lib/chains";

const COMBINED_PATH = "/";

const extractChain = (pathname: string): ChainName | null => {
  const seg = pathname.split("/", 2)[1] ?? "";
  return isChainName(seg) ? seg : null;
};

const currentSubPage = (pathname: string, chain: ChainName): string => {
  const after = pathname.slice(`/${chain}`.length);
  if (after.startsWith("/assets")) return "assets";
  if (after.startsWith("/transfers")) return "transfers";
  return "dashboard";
};

export default function ChainSwitcher() {
  const pathname = usePathname();
  const router = useRouter();
  const currentChain = extractChain(pathname);
  const isCombined = pathname === "/";

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [lastPath, setLastPath] = useState(pathname);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close + reset when route changes (render-phase derived state, no effect).
  if (lastPath !== pathname) {
    setLastPath(pathname);
    if (open) setOpen(false);
    if (query) setQuery("");
    if (active) setActive(0);
  }

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all: { key: string; label: string; href: string; current: boolean }[] = [
      {
        key: "__combined__",
        label: "All chains · Combined",
        href: COMBINED_PATH,
        current: isCombined,
      },
      ...CHAIN_NAMES.map((name) => ({
        key: name,
        label: CHAIN_DISPLAY_NAMES[name],
        href: `/${name}/dashboard`,
        current: currentChain === name,
      })),
    ];
    if (!q) return all;
    return all.filter((it) => it.label.toLowerCase().includes(q));
  }, [query, currentChain, isCombined]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onEsc);
    inputRef.current?.focus();
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const triggerLabel = isCombined
    ? "All chains"
    : currentChain
    ? CHAIN_DISPLAY_NAMES[currentChain]
    : "Select chain";

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = items[active];
      if (it) {
        if (currentChain && it.key !== "__combined__") {
          const sub = currentSubPage(pathname, currentChain);
          router.push(`/${it.key}/${sub}`);
        } else {
          router.push(it.href);
        }
        setOpen(false);
      }
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="border-bgSt bg-table_row hover:border-highlight/40 hover:text-highlight font-sfpro flex items-center gap-2 border px-3 py-1.5 text-sm text-white/85 transition-colors"
      >
        <span className="text-highlight/80 text-xs">◆</span>
        <span>{triggerLabel}</span>
        <span className="text-white/40">▾</span>
      </button>

      {open && (
        <div
          role="listbox"
          className="border-bgSt bg-background absolute right-0 top-full z-40 mt-1 w-72 border shadow-xl"
        >
          <div className="border-bgSt border-b p-2">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="Search chain…"
              className="font-sfpro placeholder:text-white/30 focus:border-highlight/60 w-full border border-transparent bg-transparent px-2 py-1.5 text-sm text-white outline-none"
            />
          </div>
          <ul className="max-h-72 overflow-y-auto py-1">
            {items.length === 0 ? (
              <li className="font-sfpro px-3 py-2 text-sm text-white/40">
                No matches
              </li>
            ) : (
              items.map((it, idx) => {
                const href =
                  currentChain && it.key !== "__combined__"
                    ? `/${it.key}/${currentSubPage(pathname, currentChain)}`
                    : it.href;
                return (
                  <li key={it.key}>
                    <Link
                      href={href}
                      onMouseEnter={() => setActive(idx)}
                      className={[
                        "font-sfpro flex items-center justify-between px-3 py-1.5 text-sm",
                        idx === active ? "bg-bgSt" : "hover:bg-bgSt",
                        it.current ? "text-highlight" : "text-white/80",
                      ].join(" ")}
                    >
                      <span>{it.label}</span>
                      {it.current && (
                        <span className="text-secondary text-xs">●</span>
                      )}
                    </Link>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
