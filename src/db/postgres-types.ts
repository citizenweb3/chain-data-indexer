// PostgreSQL's built-in text[] OID. Passing it explicitly keeps postgres.js array parameters typed
// correctly even on a cold connection before its dynamic element-to-array type map is populated.
export const TEXT_ARRAY_OID = 1009;
