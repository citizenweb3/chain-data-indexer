import { notFound } from "next/navigation";
import { isChainName } from "@/lib/chains";

export default async function ChainLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ chain: string }>;
}) {
  const { chain } = await params;
  if (!isChainName(chain)) notFound();
  return <>{children}</>;
}
