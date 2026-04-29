-- Miden Indexer schema, target: miden-node v0.13.4
-- This schema stores the public, indexer-observable subset of Miden chain data exposed by
-- the v0.13.4 public gRPC API. MVP columns cover canonical block headers, discovered
-- account-scoped transactions, tag-discovered notes, consumed nullifiers, latest account
-- commitments, and restart progress; nullable Full-scope columns reserve space for decoded
-- public payloads and future protocol/API enrichment without claiming private data visibility.

BEGIN;

COMMENT ON SCHEMA public IS 'Miden Indexer schema for miden-node v0.13.4. All BYTEA hash columns store the raw 32-byte digest as it appears on the wire (no byte reversal). Encoding to hex for the explorer API is the responsibility of src/api.ts. Block timestamps are stored as TIMESTAMPTZ values derived from blockchain.BlockHeader.timestamp, a fixed32/u32 Unix timestamp in seconds.';

CREATE TABLE IF NOT EXISTS miden_indexer_progress (
    id          INT         PRIMARY KEY DEFAULT 1,
    last_block  BIGINT      NOT NULL DEFAULT -1,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_miden_indexer_progress_singleton CHECK (id = 1)
);

COMMENT ON TABLE miden_indexer_progress IS 'Singleton resume cursor for the MVP indexer. Tracks the last block header durably indexed; future migrations can add per-stream coverage cursors for notes, nullifiers, accounts, and transactions.';
COMMENT ON COLUMN miden_indexer_progress.id IS 'Singleton key; constrained to 1 so the table has at most one logical progress row.';
COMMENT ON COLUMN miden_indexer_progress.last_block IS 'Last indexed block number. Maps to blockchain.BlockHeader.block_num / blockchain.BlockNumber.block_num; default -1 means no blocks indexed yet.';
COMMENT ON COLUMN miden_indexer_progress.updated_at IS 'Database time when this progress row was last updated; not a proto field.';

INSERT INTO miden_indexer_progress (id, last_block)
VALUES (1, -1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS miden_blocks (
    block_num              BIGINT      PRIMARY KEY,
    block_hash             BYTEA       NOT NULL UNIQUE,
    prev_block_commitment  BYTEA       NOT NULL,
    chain_commitment       BYTEA       NOT NULL,
    account_root           BYTEA       NOT NULL,
    nullifier_root         BYTEA       NOT NULL,
    note_root              BYTEA       NOT NULL,
    tx_commitment          BYTEA       NOT NULL,
    validator_key          BYTEA       NOT NULL,
    tx_kernel_commitment   BYTEA       NOT NULL,
    native_asset_id        BYTEA       NOT NULL,
    verification_base_fee  BIGINT      NOT NULL DEFAULT 0,
    timestamp              TIMESTAMPTZ NOT NULL,
    tx_count               INT         NOT NULL DEFAULT 0,
    note_count             INT         NOT NULL DEFAULT 0,
    nullifier_count        INT         NOT NULL DEFAULT 0,
    version                INT,
    raw_block_bytes        BYTEA,
    chain_length           BIGINT,
    inserted_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE miden_blocks IS 'One row per canonical block header. MVP stores all structured BlockHeader fields plus rollup counts; Full scope may attach raw GetBlockByNumber bytes and MMR chain length when collected.';
COMMENT ON COLUMN miden_blocks.block_num IS 'Maps to blockchain.BlockHeader.block_num (fixed32), widened to BIGINT for SQL consistency.';
COMMENT ON COLUMN miden_blocks.block_hash IS 'Derived block/header commitment used as the explorer block hash; v0.13.4 BlockHeader does not expose a separate block_hash field, so the indexer must compute/store the canonical header commitment bytes.';
COMMENT ON COLUMN miden_blocks.prev_block_commitment IS 'Maps to blockchain.BlockHeader.prev_block_commitment.';
COMMENT ON COLUMN miden_blocks.chain_commitment IS 'Maps to blockchain.BlockHeader.chain_commitment.';
COMMENT ON COLUMN miden_blocks.account_root IS 'Maps to blockchain.BlockHeader.account_root.';
COMMENT ON COLUMN miden_blocks.nullifier_root IS 'Maps to blockchain.BlockHeader.nullifier_root.';
COMMENT ON COLUMN miden_blocks.note_root IS 'Maps to blockchain.BlockHeader.note_root.';
COMMENT ON COLUMN miden_blocks.tx_commitment IS 'Maps to blockchain.BlockHeader.tx_commitment; prompt aliases such as tx_hash_root are not proto field names.';
COMMENT ON COLUMN miden_blocks.validator_key IS 'Maps to blockchain.BlockHeader.validator_key.validator_key bytes.';
COMMENT ON COLUMN miden_blocks.tx_kernel_commitment IS 'Maps to blockchain.BlockHeader.tx_kernel_commitment; prompt aliases such as kernel_root are not proto field names.';
COMMENT ON COLUMN miden_blocks.native_asset_id IS 'Maps to blockchain.BlockHeader.fee_parameters.native_asset_id.id (15-byte account ID).';
COMMENT ON COLUMN miden_blocks.verification_base_fee IS 'Maps to blockchain.BlockHeader.fee_parameters.verification_base_fee (fixed32), widened to BIGINT.';
COMMENT ON COLUMN miden_blocks.timestamp IS 'Derived from blockchain.BlockHeader.timestamp fixed32/u32 Unix seconds using to_timestamp(...); stored as TIMESTAMPTZ.';
COMMENT ON COLUMN miden_blocks.tx_count IS 'Indexer-derived count of transactions observed for this block; not a BlockHeader field and may be account-scoped until raw block decoding exists.';
COMMENT ON COLUMN miden_blocks.note_count IS 'Indexer-derived count of note sync records observed for this block; not a BlockHeader field and coverage depends on configured tags/raw decode.';
COMMENT ON COLUMN miden_blocks.nullifier_count IS 'Indexer-derived count of consumed nullifiers observed for this block; not a BlockHeader field and coverage depends on prefix scans.';
COMMENT ON COLUMN miden_blocks.version IS 'Maps to blockchain.BlockHeader.version; nullable to tolerate historical/default proto values omitted by JSON tooling.';
COMMENT ON COLUMN miden_blocks.raw_block_bytes IS 'Optional raw blockchain.MaybeBlock.block bytes from GetBlockByNumber; stored as BYTEA because v0.13.4 exposes an opaque winter_utils::Serializable payload rather than decoded JSON.';
COMMENT ON COLUMN miden_blocks.chain_length IS 'Optional rpc.BlockHeaderByNumberResponse.chain_length captured with an MMR proof request; not part of blockchain.BlockHeader.';
COMMENT ON COLUMN miden_blocks.inserted_at IS 'Database ingestion time; not a proto field.';

CREATE INDEX IF NOT EXISTS idx_miden_blocks_timestamp ON miden_blocks (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_miden_blocks_block_hash ON miden_blocks (block_hash);

CREATE TABLE IF NOT EXISTS miden_transactions (
    tx_id                    BYTEA       PRIMARY KEY,
    block_num                BIGINT      NOT NULL REFERENCES miden_blocks(block_num) ON DELETE CASCADE,
    account_id               BYTEA       NOT NULL,
    init_account_state       BYTEA,
    final_account_state      BYTEA,
    input_notes_commitment   BYTEA,
    output_notes_commitment  BYTEA,
    expiration_block_num     BIGINT,
    input_nullifiers         BYTEA[],
    output_note_ids          BYTEA[],
    inserted_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE miden_transactions IS 'One row per discovered transaction. MVP rows come from transaction.TransactionSummary in SyncState or account-scoped SyncTransactions correlation, so coverage is account-scoped until raw block decoding or a global transaction API is available.';
COMMENT ON COLUMN miden_transactions.tx_id IS 'Maps to transaction.TransactionSummary.transaction_id.id. SyncTransactions.TransactionRecord does not include a transaction ID, so those records must be correlated before insertion.';
COMMENT ON COLUMN miden_transactions.block_num IS 'Maps to transaction.TransactionSummary.block_num or rpc.TransactionRecord.block_num.';
COMMENT ON COLUMN miden_transactions.account_id IS 'Maps to transaction.TransactionSummary.account_id.id or transaction.TransactionHeader.account_id.id.';
COMMENT ON COLUMN miden_transactions.init_account_state IS 'Maps to transaction.TransactionHeader.initial_state_commitment.';
COMMENT ON COLUMN miden_transactions.final_account_state IS 'Maps to transaction.TransactionHeader.final_state_commitment.';
COMMENT ON COLUMN miden_transactions.input_notes_commitment IS 'Reserved for a future decoded protocol commitment; v0.13.4 transaction.proto exposes repeated input nullifiers, not this commitment directly.';
COMMENT ON COLUMN miden_transactions.output_notes_commitment IS 'Reserved for a future decoded protocol commitment; v0.13.4 transaction.proto exposes repeated output NoteSyncRecord values, not this commitment directly.';
COMMENT ON COLUMN miden_transactions.expiration_block_num IS 'Reserved for a future decoded transaction expiration field; not exposed by v0.13.4 public transaction summary/header protos.';
COMMENT ON COLUMN miden_transactions.input_nullifiers IS 'Optional denormalized list from transaction.TransactionHeader.nullifiers; each element is a raw digest BYTEA.';
COMMENT ON COLUMN miden_transactions.output_note_ids IS 'Optional denormalized list from transaction.TransactionHeader.output_notes[].note_id.id; each element is a raw digest BYTEA.';
COMMENT ON COLUMN miden_transactions.inserted_at IS 'Database ingestion time; not a proto field.';

CREATE INDEX IF NOT EXISTS idx_miden_transactions_block_num ON miden_transactions (block_num);
CREATE INDEX IF NOT EXISTS idx_miden_transactions_account_id ON miden_transactions (account_id);

CREATE TABLE IF NOT EXISTS miden_notes (
    note_id             BYTEA       PRIMARY KEY,
    block_num           BIGINT      NOT NULL REFERENCES miden_blocks(block_num) ON DELETE CASCADE,
    note_index          INT         NOT NULL,
    is_public           BOOLEAN     NOT NULL,
    metadata            BYTEA       NOT NULL,
    sender              BYTEA,
    tag                 BIGINT,
    note_type           SMALLINT,
    attachment          BYTEA,
    aux                 BIGINT,
    execution_hint      BIGINT,
    recipient_digest    BYTEA,
    assets              BYTEA,
    script_root         BYTEA,
    inputs_hash         BYTEA,
    serial_num          BYTEA,
    note_details        BYTEA,
    inserted_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE miden_notes IS 'One row per discovered note from NoteSyncRecord/GetNotesById. MVP stores ID, block/index, visibility, and metadata; Full scope nullable columns hold decoded public/network note details when available. Private note details remain unobservable.';
COMMENT ON COLUMN miden_notes.note_id IS 'Maps to note.NoteId.id / note.NoteSyncRecord.note_id.id.';
COMMENT ON COLUMN miden_notes.block_num IS 'Maps to note.NoteInclusionInBlockProof.block_num or the containing SyncNotes/SyncState block_header.block_num for NoteSyncRecord.';
COMMENT ON COLUMN miden_notes.note_index IS 'Maps to note.NoteSyncRecord.note_index_in_block / note.NoteInclusionInBlockProof.note_index_in_block.';
COMMENT ON COLUMN miden_notes.is_public IS 'Indexer-derived from note.NoteMetadata.note_type and/or whether note.Note.details is present. Note type 0b01 is public; network notes are public; private/encrypted notes are not public.';
COMMENT ON COLUMN miden_notes.metadata IS 'Serialized/raw representation of note.NoteMetadata as stored by the indexer; the proto metadata is structured, not a bytes field.';
COMMENT ON COLUMN miden_notes.sender IS 'Maps to note.NoteMetadata.sender.id.';
COMMENT ON COLUMN miden_notes.tag IS 'Maps to note.NoteMetadata.tag (fixed32), widened to BIGINT.';
COMMENT ON COLUMN miden_notes.note_type IS 'Maps to note.NoteMetadata.note_type (uint32), narrowed to SMALLINT after validation.';
COMMENT ON COLUMN miden_notes.attachment IS 'Maps to note.NoteMetadata.attachment bytes; this is the v0.13.4 proto field that contains serialized note attachment data.';
COMMENT ON COLUMN miden_notes.aux IS 'Reserved decoded metadata/component value from protocol-level note attachment; not exposed as a top-level v0.13.4 note.proto field.';
COMMENT ON COLUMN miden_notes.execution_hint IS 'Reserved decoded metadata/component value from protocol-level note attachment; not exposed as a top-level v0.13.4 note.proto field.';
COMMENT ON COLUMN miden_notes.recipient_digest IS 'Reserved decoded public-note recipient digest from note.Note.details / note.NetworkNote.details; not exposed as a top-level v0.13.4 note.proto field.';
COMMENT ON COLUMN miden_notes.assets IS 'Reserved serialized/decoded public-note asset payload from note.Note.details / note.NetworkNote.details; private note assets are not observable.';
COMMENT ON COLUMN miden_notes.script_root IS 'Reserved decoded public-note script root from note details or GetNoteScriptByRoot workflows; not a top-level NoteSyncRecord field.';
COMMENT ON COLUMN miden_notes.inputs_hash IS 'Reserved decoded public-note storage/inputs commitment from note details; not exposed as a top-level v0.13.4 note.proto field.';
COMMENT ON COLUMN miden_notes.serial_num IS 'Reserved decoded public-note serial number from note details; private serial numbers are not observable.';
COMMENT ON COLUMN miden_notes.note_details IS 'Optional raw note.Note.details or note.NetworkNote.details bytes; empty/NULL for private notes.';
COMMENT ON COLUMN miden_notes.inserted_at IS 'Database ingestion time; not a proto field.';

CREATE INDEX IF NOT EXISTS idx_miden_notes_block_num ON miden_notes (block_num);
CREATE INDEX IF NOT EXISTS idx_miden_notes_sender ON miden_notes (sender) WHERE sender IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_miden_notes_tag ON miden_notes (tag) WHERE tag IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_miden_notes_script_root ON miden_notes (script_root) WHERE script_root IS NOT NULL;

CREATE TABLE IF NOT EXISTS miden_nullifiers (
    nullifier         BYTEA       PRIMARY KEY,
    block_num         BIGINT      NOT NULL REFERENCES miden_blocks(block_num) ON DELETE CASCADE,
    consumed_note_id  BYTEA,
    inserted_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE miden_nullifiers IS 'One row per consumed nullifier observed from SyncNullifiers. MVP stores nullifier digest and consumed block; Full scope can link to known public notes when resolvable.';
COMMENT ON COLUMN miden_nullifiers.nullifier IS 'Maps to rpc.SyncNullifiersResponse.NullifierUpdate.nullifier.';
COMMENT ON COLUMN miden_nullifiers.block_num IS 'Maps to rpc.SyncNullifiersResponse.NullifierUpdate.block_num.';
COMMENT ON COLUMN miden_nullifiers.consumed_note_id IS 'Optional indexer-resolved link to miden_notes.note_id for public notes whose nullifier can be computed/matched; not exposed by SyncNullifiers.';
COMMENT ON COLUMN miden_nullifiers.inserted_at IS 'Database ingestion time; not a proto field.';

CREATE INDEX IF NOT EXISTS idx_miden_nullifiers_block_num ON miden_nullifiers (block_num);

CREATE TABLE IF NOT EXISTS miden_accounts (
    account_id          BYTEA       PRIMARY KEY,
    is_public           BOOLEAN     NOT NULL,
    last_block_num      BIGINT      NOT NULL REFERENCES miden_blocks(block_num) ON DELETE RESTRICT,
    account_commitment  BYTEA       NOT NULL,
    nonce               BIGINT,
    code_commitment     BYTEA,
    storage_commitment  BYTEA,
    vault_root          BYTEA,
    account_type        SMALLINT,
    storage_mode        SMALLINT,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE miden_accounts IS 'Latest known account commitment per account ID. MVP stores AccountSummary/AccountWitness commitment and block; Full scope stores public AccountHeader roots/nonce and decoded ID classification when available.';
COMMENT ON COLUMN miden_accounts.account_id IS 'Maps to account.AccountId.id.';
COMMENT ON COLUMN miden_accounts.is_public IS 'Indexer-derived visibility flag, usually from successful rpc.AccountResponse.details for public accounts or decoded account ID storage mode; not a standalone proto field.';
COMMENT ON COLUMN miden_accounts.last_block_num IS 'Maps to account.AccountSummary.block_num or rpc.AccountResponse.block_num.block_num.';
COMMENT ON COLUMN miden_accounts.account_commitment IS 'Maps to account.AccountSummary.account_commitment or account.AccountWitness.commitment.';
COMMENT ON COLUMN miden_accounts.nonce IS 'Maps to account.AccountHeader.nonce.';
COMMENT ON COLUMN miden_accounts.code_commitment IS 'Maps to account.AccountHeader.code_commitment; named code_commitment instead of code_root to match proto terminology.';
COMMENT ON COLUMN miden_accounts.storage_commitment IS 'Maps to account.AccountHeader.storage_commitment; named storage_commitment instead of storage_root to match proto terminology.';
COMMENT ON COLUMN miden_accounts.vault_root IS 'Maps to account.AccountHeader.vault_root.';
COMMENT ON COLUMN miden_accounts.account_type IS 'Reserved for account ID bit decoding per protocol docs; not exposed as a standalone v0.13.4 account.proto field.';
COMMENT ON COLUMN miden_accounts.storage_mode IS 'Reserved for account ID bit decoding per protocol docs; not exposed as a standalone v0.13.4 account.proto field.';
COMMENT ON COLUMN miden_accounts.updated_at IS 'Database update time for latest known state; not a proto field.';

CREATE INDEX IF NOT EXISTS idx_miden_accounts_last_block_num ON miden_accounts (last_block_num);

-- Deferred history table intent:
-- CREATE TABLE IF NOT EXISTS miden_account_state_history (
--     account_id          BYTEA       NOT NULL,
--     block_num           BIGINT      NOT NULL REFERENCES miden_blocks(block_num) ON DELETE CASCADE,
--     account_commitment  BYTEA       NOT NULL,
--     inserted_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
--     PRIMARY KEY (account_id, block_num)
-- );
-- This append-only history is deferred because the MVP sink only needs latest account state for
-- explorer pages and because SyncState returns latest account updates in a requested range rather
-- than a complete global account-change stream. Add in a later migration when account-history
-- coverage semantics are finalized.

COMMIT;
