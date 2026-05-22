import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { getTransfer } from "@/services/transfers-service";
import CopyButton from "@/components/common/copy-button";
import TxHashCell from "@/components/transfers/tx-hash-cell";
import TransferTimeline, {
  type TransferDirection,
  type TransferStatus,
} from "@/components/transfers/transfer-timeline";
import { formatDenomDisplay } from "@/utils/format-denom";
import { cn } from "@/utils/cn";

export const dynamic = "force-dynamic";

const BLOCKS_URL = "https://validatorinfo.com/en/networks/cosmoshub/blocks";
const ADDRESS_URL =
  "https://validatorinfo.com/en/networks/cosmoshub/address";

interface RouteParams {
  port: string;
  channel: string;
  sequence: string;
}

const statusBadge = (
  status: TransferStatus,
): { label: string; className: string } => {
  switch (status) {
    case "acknowledged":
      return { label: "Acknowledged", className: "bg-secondary text-background" };
    case "received":
      return { label: "Received", className: "bg-secondary text-background" };
    case "sent":
      return { label: "Sent (in-flight)", className: "bg-highlight text-background" };
    case "timeout":
      return { label: "Timeout", className: "bg-red text-white" };
    case "failed":
      return { label: "Failed", className: "bg-red text-white" };
  }
};

const formatAbsoluteTime = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
};

const formatRelativeTime = (iso: string | null): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return formatDistanceToNow(d, { addSuffix: true });
};

const formatTimeoutTs = (ts: string | null): string | null => {
  if (!ts) return null;
  try {
    const bn = BigInt(ts);
    const ms = Number(bn / BigInt(1_000_000));
    if (!Number.isFinite(ms)) return ts;
    return new Date(ms).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
  } catch {
    return ts;
  }
};

const tryParseMemo = (memo: string | null): { parsed: unknown; raw: string } | null => {
  if (!memo) return null;
  const trimmed = memo.trim();
  if (!trimmed) return null;
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return { parsed: JSON.parse(trimmed), raw: memo };
    } catch {
      return null;
    }
  }
  return null;
};

const InfoRow = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) => (
  <div className="flex w-full bg-table_row hover:bg-bgHover">
    <div className="w-3/12 items-center border-b border-r border-bgSt py-4 pl-11 font-sfpro text-lg text-white">
      {label}
    </div>
    <div className="flex w-9/12 min-w-0 items-center gap-2 border-b border-bgSt py-4 pl-6 pr-4 font-sfpro text-base text-white">
      {children}
    </div>
  </div>
);

const SectionTitle = ({ children }: { children: ReactNode }) => (
  <h2 className="mb-1 mt-8 font-sfpro text-xl uppercase tracking-wide text-white">
    {children}
  </h2>
);

const HeightLink = ({ height }: { height: string | null }) => {
  if (!height) return <span className="font-handjet text-lg text-white/40">—</span>;
  const n = Number(height);
  const label = Number.isFinite(n) ? n.toLocaleString("en-US") : height;
  return (
    <a
      href={`${BLOCKS_URL}/${encodeURIComponent(height)}`}
      target="_blank"
      rel="noopener noreferrer"
      className="font-handjet text-lg text-white hover:text-highlight hover:underline"
    >
      {label}
    </a>
  );
};

export default async function TransferDetailPage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { port, channel, sequence } = await params;

  let seqBn: bigint;
  try {
    seqBn = BigInt(sequence);
  } catch {
    notFound();
  }

  const transfer = await getTransfer({
    port: decodeURIComponent(port),
    channel: decodeURIComponent(channel),
    sequence: seqBn,
    chain: 'cosmoshub',
  });

  if (!transfer) notFound();

  const status = transfer.status as TransferStatus;
  const badge = statusBadge(status);
  const memo = tryParseMemo(transfer.memo);
  const denomDisplay = formatDenomDisplay(
    transfer.denom,
    transfer.asset_symbol,
  );
  const rawAmountN = transfer.amount ? Number(transfer.amount) : null;
  const displayAmountN =
    rawAmountN !== null &&
    Number.isFinite(rawAmountN) &&
    transfer.asset_decimals !== null
      ? rawAmountN / Math.pow(10, transfer.asset_decimals)
      : rawAmountN;
  const amountFormatted =
    displayAmountN !== null && Number.isFinite(displayAmountN)
      ? displayAmountN.toLocaleString("en-US", {
          maximumFractionDigits: transfer.asset_decimals ? 6 : 0,
        })
      : transfer.amount;
  const rawAmountFormatted =
    rawAmountN !== null && Number.isFinite(rawAmountN)
      ? rawAmountN.toLocaleString("en-US", { maximumFractionDigits: 0 })
      : transfer.amount;
  const directionLabel =
    transfer.direction === "outgoing"
      ? "→ Outgoing (from Cosmos Hub)"
      : "← Incoming (to Cosmos Hub)";
  const eventAbs = formatAbsoluteTime(transfer.event_time);
  const eventRel = formatRelativeTime(transfer.event_time);
  const timeoutAbs = formatTimeoutTs(transfer.timeout_ts);
  const syncedAbs = formatAbsoluteTime(transfer.synced_at);
  const amountUsdN = transfer.amount_usd ? Number(transfer.amount_usd) : null;
  const amountUsdFormatted =
    amountUsdN !== null && Number.isFinite(amountUsdN)
      ? amountUsdN.toLocaleString("en-US", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 2,
        })
      : null;
  const showBaseDenom =
    !!transfer.base_denom && transfer.base_denom !== transfer.denom;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-12">
      <Link
        href="/transfers"
        className="mb-4 font-sfpro text-sm uppercase tracking-wide text-white/50 hover:text-highlight"
      >
        ‹ back to transfers
      </Link>

      <div className="flex flex-wrap items-baseline gap-4">
        <h1 className="font-handjet text-4xl uppercase tracking-wide text-highlight">
          Packet #{transfer.sequence}
        </h1>
        <span
          className={cn(
            "rounded-full px-6 py-1 font-handjet text-lg uppercase tracking-wide",
            badge.className,
          )}
        >
          {badge.label}
        </span>
        <span className="font-sfpro text-base text-white/60">
          {directionLabel}
        </span>
      </div>

      <SectionTitle>Packet</SectionTitle>
      <InfoRow label="Amount">
        <span className="font-handjet text-lg text-white">
          {amountFormatted ?? "—"}
        </span>
        <span className="font-handjet text-lg text-white">{denomDisplay}</span>
        {transfer.denom ? (
          <>
            <span className="ml-2 break-all font-sfpro text-sm text-white/40">
              {transfer.denom}
            </span>
            <CopyButton value={transfer.denom} ariaLabel="Copy denom" />
          </>
        ) : null}
      </InfoRow>
      {amountUsdFormatted ? (
        <InfoRow label="Amount (USD)">
          <span className="font-handjet text-lg text-white">
            {amountUsdFormatted}
          </span>
          <span className="font-sfpro text-sm text-white/40">
            · at event-day spot
          </span>
        </InfoRow>
      ) : null}
      {transfer.asset_decimals !== null ? (
        <InfoRow label="Raw amount">
          <span className="font-handjet text-lg text-white/70">
            {rawAmountFormatted ?? "—"}
          </span>
          <span className="font-sfpro text-sm text-white/40">
            · base units ({transfer.base_denom ?? transfer.denom})
          </span>
        </InfoRow>
      ) : null}
      {showBaseDenom ? (
        <InfoRow label="Base denom">
          <span className="break-all font-handjet text-lg text-white">
            {transfer.base_denom}
          </span>
          {transfer.base_denom ? (
            <CopyButton value={transfer.base_denom} ariaLabel="Copy base denom" />
          ) : null}
        </InfoRow>
      ) : null}
      <InfoRow label="Sequence">
        <span className="font-handjet text-lg text-white">
          {transfer.sequence}
        </span>
        <CopyButton value={transfer.sequence} ariaLabel="Copy sequence" />
      </InfoRow>
      <InfoRow label="Event time">
        <span className="font-handjet text-lg text-white">{eventAbs}</span>
        {eventRel ? (
          <span className="font-sfpro text-sm text-white/50">· {eventRel}</span>
        ) : null}
      </InfoRow>
      <InfoRow label="Direction">
        <span className="font-sfpro text-base uppercase tracking-wide text-white">
          {transfer.direction}
        </span>
      </InfoRow>

      <SectionTitle>Lifecycle</SectionTitle>
      <div className="border-b border-bgSt bg-table_row py-4 pl-11 pr-4">
        <TransferTimeline
          direction={transfer.direction as TransferDirection}
          status={status}
          heightSend={transfer.height_send}
          txHashSend={transfer.tx_hash_send}
          heightRecv={transfer.height_recv}
          txHashRecv={transfer.tx_hash_recv}
          heightAck={transfer.height_ack}
          txHashAck={transfer.tx_hash_ack}
        />
      </div>

      <SectionTitle>Channels</SectionTitle>
      <InfoRow label="Port (src)">
        <span className="font-handjet text-lg text-white">
          {transfer.port_id_src}
        </span>
        <CopyButton value={transfer.port_id_src} />
      </InfoRow>
      <InfoRow label="Channel (src)">
        <Link
          href={`/channels/${encodeURIComponent(transfer.channel_id_src)}`}
          className="font-handjet text-lg text-white hover:text-highlight hover:underline"
        >
          {transfer.channel_id_src}
        </Link>
        <CopyButton value={transfer.channel_id_src} />
      </InfoRow>
      <InfoRow label="Port (dst)">
        <span className="font-handjet text-lg text-white">
          {transfer.port_id_dst ?? "—"}
        </span>
      </InfoRow>
      <InfoRow label="Channel (dst)">
        <span className="font-handjet text-lg text-white">
          {transfer.channel_id_dst ?? "—"}
        </span>
      </InfoRow>

      <SectionTitle>On-chain trace</SectionTitle>
      <InfoRow label="Event height">
        <HeightLink height={transfer.event_height} />
      </InfoRow>
      {transfer.direction === "outgoing" ? (
        <>
          <InfoRow label="Send tx">
            <TxHashCell hash={transfer.tx_hash_send} full />
          </InfoRow>
          <InfoRow label="Ack tx">
            <TxHashCell hash={transfer.tx_hash_ack} full />
          </InfoRow>
        </>
      ) : (
        <InfoRow label="Recv tx">
          <TxHashCell hash={transfer.tx_hash_recv} full />
        </InfoRow>
      )}
      <InfoRow label="Synced at">
        <span className="font-handjet text-lg text-white/70">{syncedAbs}</span>
      </InfoRow>
      <InfoRow label="Relayer">
        {transfer.relayer ? (
          <>
            <a
              href={`${ADDRESS_URL}/${encodeURIComponent(transfer.relayer)}/passport`}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all font-handjet text-lg text-white hover:text-highlight hover:underline"
            >
              {transfer.relayer}
            </a>
            <CopyButton value={transfer.relayer} ariaLabel="Copy relayer" />
          </>
        ) : (
          <span className="font-handjet text-lg text-white/40">—</span>
        )}
      </InfoRow>

      <SectionTitle>Memo</SectionTitle>
      {memo ? (
        <div className="border-b border-bgSt bg-table_row py-4 pl-11 pr-4">
          <pre className="overflow-x-auto whitespace-pre-wrap break-all font-handjet text-base text-white">
            {JSON.stringify(memo.parsed, null, 2)}
          </pre>
          <div className="mt-2 flex items-center gap-2 font-sfpro text-sm text-white/40">
            <span>parsed as JSON</span>
            <CopyButton value={memo.raw} ariaLabel="Copy memo" />
          </div>
        </div>
      ) : (
        <InfoRow label="Memo">
          {transfer.memo ? (
            <>
              <span className="break-all font-sfpro text-base">
                {transfer.memo}
              </span>
              <CopyButton value={transfer.memo} ariaLabel="Copy memo" />
            </>
          ) : (
            <span className="font-sfpro text-base text-white/40">empty</span>
          )}
        </InfoRow>
      )}

      {(status === "sent" || status === "timeout") &&
      (transfer.timeout_height || transfer.timeout_ts) ? (
        <>
          <SectionTitle>Timeout</SectionTitle>
          <InfoRow label="Timeout height">
            <span className="font-handjet text-lg text-white">
              {transfer.timeout_height ?? "—"}
            </span>
          </InfoRow>
          <InfoRow label="Timeout time">
            <span className="font-handjet text-lg text-white">
              {timeoutAbs ?? "—"}
            </span>
          </InfoRow>
        </>
      ) : null}
    </main>
  );
}
