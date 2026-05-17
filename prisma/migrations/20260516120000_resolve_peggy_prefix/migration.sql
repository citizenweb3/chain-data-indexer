-- Extend resolve_base_denom to handle Gravity Bridge "peggy" prefix.
-- Example: peggy0xdAC17F958D2ee523a2206206994597C13D831ec7 (USDT through
-- Gravity Bridge) resolves to 0xdac17f958d2ee523a2206206994597c13d831ec7
-- so it joins the existing USDT asset row keyed by the lowercase 0x denom.

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
  IF cur ~ '^peggy0x[0-9a-fA-F]+$' THEN
    cur := lower(substring(cur from 6));
  END IF;
  RETURN cur;
END;
$$;
