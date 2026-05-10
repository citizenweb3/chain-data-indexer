declare module 'json-bigint' {
  interface JsonBigOptions {
    storeAsString?: boolean;
    strict?: boolean;
    alwaysParseAsBig?: boolean;
    useNativeBigInt?: boolean;
  }

  interface JsonBig {
    parse<T = unknown>(text: string): T;
    stringify(value: unknown): string;
  }

  export default function JSONbigFactory(options?: JsonBigOptions): JsonBig;
}
