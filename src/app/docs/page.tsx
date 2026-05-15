import Script from 'next/script';

export const dynamic = 'force-static';

export const metadata = {
  title: 'API Docs — Crosschain IBC Indexer',
};

const DocsPage = () => (
  <>
    <div
      id="api-reference"
      data-url="/api/openapi.json"
      data-configuration='{"theme":"deepSpace","layout":"modern","hideClientButton":false}'
    />
    <Script
      src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"
      strategy="afterInteractive"
    />
  </>
);

export default DocsPage;
