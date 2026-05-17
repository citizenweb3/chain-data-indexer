import type { FC } from "react";
import TxHashCell from "@/components/transfers/tx-hash-cell";
import { cn } from "@/utils/cn";

const BLOCKS_URL = "https://validatorinfo.com/en/networks/cosmoshub/blocks";

export type TransferStatus =
  | "sent"
  | "received"
  | "acknowledged"
  | "timeout"
  | "failed";

export type TransferDirection = "outgoing" | "incoming";

interface TimelineProps {
  direction: TransferDirection;
  status: TransferStatus;
  heightSend: string | null;
  txHashSend: string | null;
  heightRecv: string | null;
  txHashRecv: string | null;
  heightAck: string | null;
  txHashAck: string | null;
}

type StepKind = "send" | "recv" | "ack" | "timeout";

interface Step {
  kind: StepKind;
  title: string;
  height: string | null;
  txHash: string | null;
  isLocal: boolean;
  done: boolean;
  failed?: boolean;
}

const HeightInline: FC<{ height: string | null }> = ({ height }) => {
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

const StepMarker: FC<{ step: Step }> = ({ step }) => {
  const base = "inline-flex h-6 w-6 items-center justify-center rounded-full font-handjet text-sm";
  if (!step.isLocal) {
    return (
      <span
        className={cn(base, "border border-white/20 text-white/40")}
        title="Happens on counterparty chain"
      >
        ↗
      </span>
    );
  }
  if (step.failed) {
    return <span className={cn(base, "bg-red/20 text-red")}>✕</span>;
  }
  if (step.done) {
    return <span className={cn(base, "bg-secondary/20 text-secondary")}>✓</span>;
  }
  return <span className={cn(base, "border border-white/20 text-white/30")}>·</span>;
};

const StepLine: FC<{ step: Step }> = ({ step }) => (
  <div className="flex flex-wrap items-center gap-3">
    <StepMarker step={step} />
    <span className="font-sfpro text-base uppercase tracking-wide text-white/70">
      {step.title}
    </span>
    {!step.isLocal ? (
      <span className="font-sfpro text-sm text-white/40">on counterparty chain</span>
    ) : step.done ? (
      <>
        {step.height ? (
          <span className="flex items-center gap-1.5">
            <span className="font-sfpro text-sm text-white/40">height</span>
            <HeightInline height={step.height} />
          </span>
        ) : null}
        {step.txHash ? (
          <span className="flex items-center gap-1.5">
            <span className="font-sfpro text-sm text-white/40">tx</span>
            <TxHashCell hash={step.txHash} />
          </span>
        ) : null}
      </>
    ) : (
      <span className="font-sfpro text-sm text-white/40">pending</span>
    )}
  </div>
);

const TransferTimeline: FC<TimelineProps> = ({
  direction,
  status,
  heightSend,
  txHashSend,
  heightRecv,
  txHashRecv,
  heightAck,
  txHashAck,
}) => {
  const isOutgoing = direction === "outgoing";
  const isTimeout = status === "timeout";
  const isFailed = status === "failed";
  const sendLocal = isOutgoing;
  const recvLocal = !isOutgoing;
  const ackLocal = isOutgoing;

  const sendDone = sendLocal ? !!heightSend || !!txHashSend : false;
  const recvDone = recvLocal ? !!heightRecv || !!txHashRecv : false;
  const ackDone = ackLocal ? !!heightAck || !!txHashAck : false;

  const sendStep: Step = {
    kind: "send",
    title: "Sent",
    height: heightSend,
    txHash: txHashSend,
    isLocal: sendLocal,
    done: sendDone,
  };

  const recvStep: Step = {
    kind: "recv",
    title: "Received",
    height: heightRecv,
    txHash: txHashRecv,
    isLocal: recvLocal,
    done: recvDone,
  };

  const finalStep: Step = isTimeout
    ? {
        kind: "timeout",
        title: "Timeout",
        height: null,
        txHash: null,
        isLocal: ackLocal,
        done: true,
        failed: true,
      }
    : {
        kind: "ack",
        title: isFailed ? "Ack (failed)" : "Acknowledged",
        height: heightAck,
        txHash: txHashAck,
        isLocal: ackLocal,
        done: ackDone,
        failed: isFailed && ackDone,
      };

  const steps: Step[] = [sendStep, recvStep, finalStep];

  return (
    <div className="flex flex-col gap-2">
      {steps.map((step) => (
        <StepLine key={step.kind} step={step} />
      ))}
    </div>
  );
};

export default TransferTimeline;
