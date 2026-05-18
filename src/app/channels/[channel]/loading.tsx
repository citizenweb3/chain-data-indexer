import ChartSkeleton from "@/components/charts/chart-skeleton";
import LoadingBlock from "@/components/ui/loading-block";

export default function ChannelDetailLoading() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <span className="font-sfpro text-xs tracking-wide text-white/50 uppercase">
          ‹ back to dashboard
        </span>
        <h1 className="font-handjet text-highlight text-4xl tracking-wide uppercase">
          Cosmos Hub
        </h1>
        <p className="font-sfpro text-sm text-white/40">loading channel…</p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <LoadingBlock height="h-32" />
        <LoadingBlock height="h-32" />
      </div>

      <section className="border-bgSt bg-table_row border p-6">
        <ChartSkeleton variant="full" />
      </section>

      <section className="border-bgSt bg-table_row border p-6">
        <ChartSkeleton variant="full" />
      </section>

      <LoadingBlock height="h-96" label="loading packets" />
    </main>
  );
}
