import Link from "next/link";
import { notFound } from "next/navigation";
import { getTransfer } from "@/services/transfers-service";

export const dynamic = "force-dynamic";

interface RouteParams {
  port: string;
  channel: string;
  sequence: string;
}

const formatField = (value: string | null) => value ?? "—";

const formatAmount = (amount: string | null, denom: string | null) => {
  if (!amount || !denom) return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return `${amount} ${denom}`;
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${denom}`;
};

const Field = ({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) => (
  <div className="flex flex-col gap-1 border-b border-bgSt py-3">
    <span className="font-sfpro text-xs uppercase tracking-wide text-white/50">
      {label}
    </span>
    <span
      className={`break-all text-white ${
        mono ? "font-handjet text-base" : "font-sfpro text-sm"
      }`}
    >
      {value}
    </span>
  </div>
);

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
  });

  if (!transfer) notFound();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-2">
        <Link
          href="/transfers"
          className="font-sfpro text-xs uppercase tracking-wide text-white/50 hover:text-highlight"
        >
          ‹ back to transfers
        </Link>
        <h1 className="font-handjet text-3xl tracking-wide text-highlight">
          Transfer #{transfer.sequence}
        </h1>
        <p className="font-sfpro text-sm text-white/70">
          {transfer.port_id_src}/{transfer.channel_id_src} → packet sequence{" "}
          {transfer.sequence}
        </p>
      </header>

      <section className="rounded-md border border-bgSt bg-card p-5">
        <h2 className="mb-3 font-sfpro text-sm uppercase tracking-wide text-white/60">
          Identity
        </h2>
        <Field label="Port (src)" value={transfer.port_id_src} mono />
        <Field label="Channel (src)" value={transfer.channel_id_src} mono />
        <Field
          label="Port (dst)"
          value={formatField(transfer.port_id_dst)}
          mono
        />
        <Field
          label="Channel (dst)"
          value={formatField(transfer.channel_id_dst)}
          mono
        />
        <Field label="Sequence" value={transfer.sequence} mono />
        <Field label="Direction" value={transfer.direction} />
        <Field label="Status" value={transfer.status} />
      </section>

      <section className="rounded-md border border-bgSt bg-card p-5">
        <h2 className="mb-3 font-sfpro text-sm uppercase tracking-wide text-white/60">
          Asset
        </h2>
        <Field
          label="Denom"
          value={formatField(transfer.denom)}
          mono
        />
        <Field
          label="Amount"
          value={formatAmount(transfer.amount, transfer.denom)}
          mono
        />
        <Field label="Memo" value={formatField(transfer.memo)} />
      </section>

      <section className="rounded-md border border-bgSt bg-card p-5">
        <h2 className="mb-3 font-sfpro text-sm uppercase tracking-wide text-white/60">
          On-chain trace
        </h2>
        <Field
          label="Event height"
          value={formatField(transfer.event_height)}
          mono
        />
        <Field
          label="Event time"
          value={formatField(transfer.event_time)}
        />
        <Field
          label="Send tx"
          value={formatField(transfer.tx_hash_send)}
          mono
        />
        <Field
          label="Send height"
          value={formatField(transfer.height_send)}
          mono
        />
        <Field
          label="Recv tx"
          value={formatField(transfer.tx_hash_recv)}
          mono
        />
        <Field
          label="Recv height"
          value={formatField(transfer.height_recv)}
          mono
        />
        <Field
          label="Ack tx"
          value={formatField(transfer.tx_hash_ack)}
          mono
        />
        <Field
          label="Ack height"
          value={formatField(transfer.height_ack)}
          mono
        />
        <Field label="Relayer" value={formatField(transfer.relayer)} mono />
      </section>

      <section className="rounded-md border border-bgSt bg-card p-5">
        <h2 className="mb-3 font-sfpro text-sm uppercase tracking-wide text-white/60">
          Timeout
        </h2>
        <Field
          label="Timeout height"
          value={formatField(transfer.timeout_height)}
          mono
        />
        <Field
          label="Timeout timestamp"
          value={formatField(transfer.timeout_ts)}
          mono
        />
      </section>
    </main>
  );
}
