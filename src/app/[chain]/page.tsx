import { redirect } from "next/navigation";

export default async function ChainIndex({
  params,
}: {
  params: Promise<{ chain: string }>;
}) {
  const { chain } = await params;
  redirect(`/${chain}/dashboard`);
}
