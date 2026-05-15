import Link from "next/link";
import type { FC, ReactNode } from "react";
import { cn } from "@/utils/cn";

interface TablePaginationProps {
  pageLength: number;
  currentSearch?: string | URLSearchParams;
  pageParam?: string;
  isScroll?: boolean;
  hideLastPage?: boolean;
  className?: string;
}

interface PageElement {
  href: string;
  name: string | number | ReactNode;
  isCurrent?: boolean;
}

const TriangleButton: FC<{ direction: "l" | "r" }> = ({ direction }) => (
  <span className="inline-block font-handjet text-base leading-none">
    {direction === "l" ? "‹" : "›"}
  </span>
);

const TablePagination: FC<TablePaginationProps> = ({
  pageLength,
  currentSearch,
  pageParam = "p",
  isScroll = true,
  hideLastPage,
  className,
}) => {
  const sp =
    currentSearch instanceof URLSearchParams
      ? new URLSearchParams(currentSearch.toString())
      : new URLSearchParams(currentSearch ?? "");

  const currentPage = Math.max(1, parseInt(sp.get(pageParam) ?? "1", 10) || 1);
  const pages: PageElement[] = [];

  const hrefFor = (page: number) => {
    const next = new URLSearchParams(sp.toString());
    next.set(pageParam, String(page));
    return next.toString();
  };

  if (currentPage > 1) {
    pages.push({
      href: hrefFor(currentPage - 1),
      name: <TriangleButton direction="l" />,
    });
  }

  if (currentPage > 1) {
    pages.push({ href: hrefFor(1), name: 1 });
  }

  if (currentPage >= 3) {
    pages.push({ href: "", name: "..." });
    pages.push({ href: hrefFor(currentPage - 1), name: currentPage - 1 });
  }

  pages.push({ href: "", name: currentPage, isCurrent: true });

  if (currentPage <= pageLength - 2) {
    pages.push({ href: hrefFor(currentPage + 1), name: currentPage + 1 });
  }

  if (currentPage <= pageLength - 3) {
    pages.push({ href: "", name: "..." });
  }

  if (currentPage < pageLength && !hideLastPage) {
    pages.push({ href: hrefFor(pageLength), name: pageLength });
  }

  if (currentPage < pageLength) {
    pages.push({
      href: hrefFor(currentPage + 1),
      name: <TriangleButton direction="r" />,
    });
  }

  if (pageLength < 2) {
    return <div className="h-8" />;
  }

  return (
    <div
      className={cn(
        "flex flex-row items-center justify-end space-x-2",
        className,
      )}
    >
      {pages.map((page, idx) => {
        const content = (
          <div
            className={cn(
              "border-b px-2 font-handjet text-base",
              page.isCurrent
                ? "border-highlight text-highlight"
                : "border-bgSt",
              page.href &&
                !page.isCurrent &&
                "hover:border-highlight hover:text-highlight active:border-none",
            )}
          >
            {page.name}
          </div>
        );

        if (!page.href) {
          return <span key={`pg-${idx}`}>{content}</span>;
        }
        return (
          <Link key={`pg-${idx}`} href={`?${page.href}`} scroll={isScroll}>
            {content}
          </Link>
        );
      })}
    </div>
  );
};

export default TablePagination;
