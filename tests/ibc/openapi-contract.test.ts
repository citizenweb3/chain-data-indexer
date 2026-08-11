import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import CoverageDisclosure, {
  summarizeCoverageStatuses,
} from '@/components/common/coverage-disclosure';
import { generateOpenApiDocument } from '@/lib/openapi';

type JsonObject = Record<string, unknown>;

const asObject = (value: unknown): JsonObject => {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value as JsonObject;
};

const getQueryEnum = (document: JsonObject, path: string, name: string): string[] => {
  const paths = asObject(document.paths);
  const operation = asObject(asObject(paths[path]).get);
  const parameters = operation.parameters;
  assert.ok(Array.isArray(parameters));
  const parameter = parameters.map(asObject).find((item) => item.name === name);
  assert.ok(parameter);
  const values = asObject(parameter.schema).enum;
  assert.ok(Array.isArray(values));
  return values as string[];
};

const getComponentSchema = (document: JsonObject, name: string): JsonObject => {
  const components = asObject(document.components);
  return asObject(asObject(components.schemas)[name]);
};

const getStatsDataProperties = (document: JsonObject, name: string): JsonObject => {
  const response = getComponentSchema(document, name);
  const properties = asObject(response.properties);
  return asObject(asObject(properties.data).properties);
};

const getChannelRowProperties = (document: JsonObject, name: string): JsonObject => {
  const response = getComponentSchema(document, name);
  const properties = asObject(response.properties);
  const data = asObject(properties.data);
  return asObject(asObject(data.items).properties);
};

test('generated OpenAPI separates combined and per-chain native contracts', () => {
  const document = generateOpenApiDocument() as unknown as JsonObject;

  assert.deepEqual(getQueryEnum(document, '/api/v1/timeseries', 'metric'), [
    'transfers',
    'volume_atom',
    'volume_usd',
  ]);
  assert.deepEqual(getQueryEnum(document, '/api/v1/{chain}/timeseries', 'metric'), [
    'transfers',
    'volume_atom',
    'volume_native',
    'volume_usd',
  ]);
  assert.deepEqual(getQueryEnum(document, '/api/v1/channels', 'sort'), [
    'transfers',
    'volume_atom',
    'volume_usd',
    'last_activity',
  ]);
  assert.deepEqual(getQueryEnum(document, '/api/v1/{chain}/channels', 'sort'), [
    'transfers',
    'volume_atom',
    'volume_native',
    'volume_usd',
    'last_activity',
  ]);

  const combinedStats = getStatsDataProperties(document, 'StatsCombinedResponse');
  const chainStats = getStatsDataProperties(document, 'StatsChainResponse');
  assert.equal('volume_native' in combinedStats, false);
  assert.equal('volume_native' in chainStats, true);
  assert.equal(asObject(combinedStats.volume_atom).deprecated, true);
  assert.match(String(asObject(chainStats.volume_atom).description), /deprecated/i);

  const combinedChannel = getChannelRowProperties(document, 'ChannelsCombinedResponse');
  const chainChannel = getChannelRowProperties(document, 'ChannelsChainResponse');
  assert.equal('volume_native' in combinedChannel, false);
  assert.equal('volume_native' in chainChannel, true);
  assert.equal(asObject(chainChannel.volume_atom).deprecated, true);
  assert.ok('coverage' in combinedChannel);
  assert.ok(
    'generated_at' in asObject(getComponentSchema(document, 'ChannelsChainResponse').properties),
  );
});

test('coverage disclosure sums corrected points and never claims volume share', () => {
  const corrected = summarizeCoverageStatuses([
    {
      quality: 'corrected',
      coverage: {
        eligible_packets: 2,
        priced_packets: 1,
        unpriced_packets: 1,
        unpriced_denoms: ['ufoo'],
      },
    },
    {
      quality: 'corrected',
      coverage: {
        eligible_packets: 3,
        priced_packets: 2,
        unpriced_packets: 1,
        unpriced_denoms: ['ufoo', 'ubar'],
      },
    },
  ]);
  assert.deepEqual(corrected, {
    quality: 'corrected',
    coverage: {
      eligible_packets: 5,
      priced_packets: 3,
      unpriced_packets: 2,
      unpriced_denoms: ['ubar', 'ufoo'],
    },
  });

  const html = renderToStaticMarkup(createElement(CoverageDisclosure, { status: corrected }));
  assert.match(html, /3 of 5 delivered packets priced/);
  assert.doesNotMatch(html, /volume share/i);

  assert.deepEqual(
    summarizeCoverageStatuses([corrected, { quality: 'legacy_unverified', coverage: null }]),
    { quality: 'mixed', coverage: null },
  );
});
