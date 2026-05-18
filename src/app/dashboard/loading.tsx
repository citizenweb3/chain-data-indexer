import Subtitle from "@/components/common/subtitle";
import ChartSkeleton from "@/components/charts/chart-skeleton";
import LoadingBlock from "@/components/ui/loading-block";

export default function DashboardLoading() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="font-handjet text-highlight text-4xl tracking-wide uppercase">
          Cosmos Hub IBC stats
        </h1>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-3">
          <Subtitle>Cosmos Hub transfers</Subtitle>
          <LoadingBlock height="h-32" />
        </div>
        <div className="flex flex-col gap-3">
          <Subtitle>Last sync</Subtitle>
          <LoadingBlock height="h-32" />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <Subtitle>Volume (USD)</Subtitle>
        <section className="border-bgSt bg-table_row border p-6">
          <ChartSkeleton variant="full" />
        </section>
      </div>

      <div className="flex flex-col gap-3">
        <Subtitle>Transfers</Subtitle>
        <section className="border-bgSt bg-table_row border p-6">
          <ChartSkeleton variant="full" />
        </section>
      </div>

      <div className="flex flex-col gap-3">
        <Subtitle>Top assets</Subtitle>
        <LoadingBlock height="h-48" label="loading assets" />
      </div>

      <div className="flex flex-col gap-3">
        <Subtitle>Channels</Subtitle>
        <LoadingBlock height="h-96" label="loading channels" />
      </div>
    </main>
  );
}
