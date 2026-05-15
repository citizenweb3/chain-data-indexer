import { formatDistanceToNowStrict, parseISO } from 'date-fns';

const toDate = (value: Date | string | number | null | undefined): Date | null => {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : typeof value === 'string' ? parseISO(value) : new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
};

export const formatRelativeTime = (value: Date | string | number | null | undefined): string | null => {
  const d = toDate(value);
  if (!d) return null;
  return formatDistanceToNowStrict(d, { addSuffix: true });
};

export const formatIsoUtc = (value: Date | string | number | null | undefined): string | null => {
  const d = toDate(value);
  if (!d) return null;
  return d.toISOString();
};
