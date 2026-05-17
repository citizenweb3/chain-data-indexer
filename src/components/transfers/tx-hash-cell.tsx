import type { FC } from "react";
import CopyButton from "@/components/common/copy-button";

const VALIDATORINFO_TX_URL = "https://validatorinfo.com/en/networks/cosmoshub/tx";

const shortHash = (hash: string): string => {
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 6)}…${hash.slice(-6)}`;
};

interface TxHashCellProps {
  hash: string | null;
  full?: boolean;
}

const TxHashCell: FC<TxHashCellProps> = ({ hash, full = false }) => {
  if (!hash) {
    return (
      <div className="text-center font-handjet text-base text-white/40">—</div>
    );
  }

  const url = `${VALIDATORINFO_TX_URL}/${encodeURIComponent(hash)}`;
  const label = full ? hash : shortHash(hash);

  return (
    <div className="flex items-center justify-center gap-2">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all font-handjet text-base text-white underline-offset-4 hover:text-highlight hover:underline"
        title={hash}
      >
        {label}
      </a>
      <CopyButton value={hash} ariaLabel="Copy tx hash" />
    </div>
  );
};

export default TxHashCell;
