import { notFound } from "next/navigation";
import { isChainName, CHAIN_DISPLAY_NAMES } from "@/lib/chains";
import ChainTabs from "@/components/layout/chain-tabs";

export default async function ChainLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ chain: string }>;
}) {
  const { chain } = await params;
  if (!isChainName(chain)) notFound();

  return (
    <>
      <div className="border-bgSt border-b">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-6 pt-8 pb-0">
          <header className="flex flex-col gap-1">
            <div className="font-sfpro text-[11px] uppercase tracking-[0.18em] text-white/40">
              Chain
            </div>
            <h1 className="font-handjet text-highlight text-4xl tracking-wide uppercase">
              {CHAIN_DISPLAY_NAMES[chain]}{" "}
              <span className="text-white/55">IBC stats</span>
            </h1>
          </header>
          <ChainTabs chain={chain} />
        </div>
      </div>
      {children}
    </>
  );
}
