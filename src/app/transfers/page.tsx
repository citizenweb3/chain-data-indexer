import Link from "next/link";
import {
  listTransfers,
  type TransferFilterDirection,
} from "@/services/transfers-service";
import TransfersTable from "@/components/transfers/transfers-table";

export const dynamic = "force-dynamic";

interface SearchParams {
  limit?: string;
  direction?: string;
  status?: string;
  channel?: string;
  denom?: string;
  beforeHeight?: string;
  beforeSequence?: string;
  beforeChannel?: string;
  beforePort?: string;
}

type TransferStatus = "sent" | "received" | "acknowledged" | "timeout" | "failed";

const isDirection = (v: unknown): v is TransferFilterDirection =>
  v === "outgoing" || v === "incoming" || v === "both";

const isStatus = (v: unknown): v is TransferStatus =>
  v === "sent" ||
  v === "received" ||
  v === "acknowledged" ||
  v === "timeout" ||
  v === "failed";

const parseBigint = (s: string | undefined): bigint | undefined => {
  if (!s) return undefined;
  try {
    return BigInt(s);
  } catch {
    return undefined;
  }
};

const clampLimit = (raw: string | undefined): number => {
  const n = parseInt(raw ?? "20", 10);
  if (!Number.isFinite(n) || n <= 0) return 20;
  return Math.min(100, n);
};

export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;

  const limit = clampLimit(sp.limit);
  const direction = isDirection(sp.direction) ? sp.direction : undefined;
  const status = isStatus(sp.status) ? sp.status : undefined;
  const channelIdSrc = sp.channel || undefined;
  const denom = sp.denom || undefined;

  const beforeHeight = parseBigint(sp.beforeHeight);
  const beforeSequence = parseBigint(sp.beforeSequence);
  const beforeChannel = sp.beforeChannel || undefined;
  const beforePort = sp.beforePort || undefined;

  const result = await listTransfers({
    limit,
    direction,
    status,
    channelIdSrc,
    denom,
    beforeHeight,
    beforeSequence,
    beforeChannel,
    beforePort,
  });

  const filtersSearch = new URLSearchParams();
  if (sp.limit) filtersSearch.set("limit", sp.limit);
  if (direction) filtersSearch.set("direction", direction);
  if (status) filtersSearch.set("status", status);
  if (channelIdSrc) filtersSearch.set("channel", channelIdSrc);
  if (denom) filtersSearch.set("denom", denom);

  const olderHref = (() => {
    if (!result.cursor) return null;
    const next = new URLSearchParams(filtersSearch);
    next.set("beforeHeight", result.cursor.next_before_height);
    next.set("beforeSequence", result.cursor.next_before_sequence);
    next.set("beforeChannel", result.cursor.next_before_channel);
    next.set("beforePort", result.cursor.next_before_port);
    return `/transfers?${next.toString()}`;
  })();

  const resetHref = `/transfers${filtersSearch.toString() ? `?${filtersSearch.toString()}` : ""}`;
  const hasCursor =
    !!sp.beforeHeight ||
    !!sp.beforeSequence ||
    !!sp.beforeChannel ||
    !!sp.beforePort;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="font-handjet text-4xl tracking-wide text-highlight">
          IBC Transfers
        </h1>
        <p className="font-sfpro text-sm text-white/70">
          {result.total} total · showing {result.data.length} per page
          {hasCursor ? " · cursor active" : ""}
        </p>
      </header>

      <TransfersTable transfers={result.data} />

      <div className="flex flex-row items-center justify-end gap-4">
        {hasCursor && (
          <Link
            href={resetHref}
            className="border-b border-bgSt px-2 font-handjet text-base hover:border-highlight hover:text-highlight"
          >
            Reset
          </Link>
        )}
        {olderHref && (
          <Link
            href={olderHref}
            className="border-b border-bgSt px-2 font-handjet text-base hover:border-highlight hover:text-highlight"
          >
            Older ›
          </Link>
        )}
      </div>
    </main>
  );
}
