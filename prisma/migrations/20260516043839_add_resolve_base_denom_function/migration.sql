-- Resolves an ICS-20 trace denom to its base denom by stripping
-- "transfer/<channel-or-wasm-id>/" prefixes iteratively. Mirrors
-- the TypeScript resolveBaseDenom in server/tools/denom.ts so SQL
-- aggregations and TS code agree on canonical base denoms.

CREATE OR REPLACE FUNCTION resolve_base_denom(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  cur text;
  hop int := 0;
BEGIN
  IF raw IS NULL THEN
    RETURN '__unknown__';
  END IF;
  cur := btrim(raw);
  IF cur = '' THEN
    RETURN '__unknown__';
  END IF;
  WHILE hop < 16 AND cur ~ '^transfer/[^/]+/' LOOP
    cur := regexp_replace(cur, '^transfer/[^/]+/', '');
    hop := hop + 1;
  END LOOP;
  RETURN cur;
END;
$$;
