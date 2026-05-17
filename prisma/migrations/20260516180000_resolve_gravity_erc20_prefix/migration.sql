-- Extend resolve_base_denom to also strip Gravity Bridge "gravity0x..."
-- and Sifchain "erc20:0x..." prefixes so bridged tokens map onto their
-- canonical lowercase hex contract address (matching the seeded denoms
-- such as USDC `0xa0b86991...`, USDT `0xdac17f958d...`).

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
  ELSIF cur ~ '^gravity0x[0-9a-fA-F]+$' THEN
    cur := lower(substring(cur from 8));
  ELSIF cur ~ '^erc20:0x[0-9a-fA-F]+$' THEN
    cur := lower(substring(cur from 7));
  END IF;
  RETURN cur;
END;
$$;
