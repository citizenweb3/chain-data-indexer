use miden_protocol::block::{ProvenBlock, SignedBlock};
use miden_protocol::note::NoteType;
use miden_protocol::utils::serde::Deserializable;
use serde::Serialize;

// ── Output types ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct TxData {
    pub tx_id: String,
    pub account_id: String,
    pub init_state: String,
    pub final_state: String,
}

#[derive(Debug, Serialize)]
pub struct NoteData {
    pub note_id: String,
    pub batch_index: usize,
    pub note_index: usize,
    pub tag: u32,
    pub sender: String,
    pub is_public: bool,
}

#[derive(Debug, Serialize)]
pub struct NullifierData {
    pub nullifier: String,
}

#[derive(Debug, Serialize)]
pub struct AccountUpdateData {
    pub account_id: String,
    pub final_state: String,
    pub is_private: bool,
}

#[derive(Debug, Serialize)]
pub struct BlockDecoded {
    pub tx_count: usize,
    pub note_count: usize,
    pub nullifier_count: usize,
    pub account_update_count: usize,
    pub transactions: Vec<TxData>,
    pub notes: Vec<NoteData>,
    pub nullifiers: Vec<NullifierData>,
    pub account_updates: Vec<AccountUpdateData>,
}

// ── Word helper ──────────────────────────────────────────────────────────────

/// Serialise a `[Felt; 4]` Word to a 32-byte big-endian hex string (no "0x" prefix).
fn word_to_hex(word: miden_protocol::Word) -> String {
    let bytes = word.as_bytes();
    hex::encode(bytes)
}

// ── Decoder ─────────────────────────────────────────────────────────────────

pub fn decode_block(block_num: u32, raw_bytes: &[u8]) -> Result<BlockDecoded, String> {
    // Genesis (block 0) is serialised as ProvenBlock (header + body + sig + proof).
    // All other blocks are SignedBlock (header + body + sig).
    let body = if block_num == 0 {
        ProvenBlock::read_from_bytes(raw_bytes)
            .map_err(|e| format!("genesis ProvenBlock decode: {e}"))?
            .body()
            .clone()
    } else {
        SignedBlock::read_from_bytes(raw_bytes)
            .map_err(|e| format!("SignedBlock decode: {e}"))?
            .body()
            .clone()
    };

    // ── Transactions ──────────────────────────────────────────────────────
    let transactions: Vec<TxData> = body
        .transactions()
        .as_slice()
        .iter()
        .map(|tx| TxData {
            tx_id: tx.id().to_hex(),
            account_id: tx.account_id().to_hex(),
            init_state: word_to_hex(tx.initial_state_commitment()),
            final_state: word_to_hex(tx.final_state_commitment()),
        })
        .collect();

    // ── Output notes ──────────────────────────────────────────────────────
    let notes: Vec<NoteData> = body
        .output_notes()
        .map(|(idx, note)| {
            let meta = note.metadata();
            NoteData {
                note_id: note.id().to_hex(),
                batch_index: idx.batch_idx(),
                note_index: idx.note_idx_in_batch(),
                tag: meta.tag().as_u32(),
                sender: meta.sender().to_hex(),
                is_public: meta.note_type() == NoteType::Public,
            }
        })
        .collect();

    // ── Nullifiers ────────────────────────────────────────────────────────
    let nullifiers: Vec<NullifierData> = body
        .created_nullifiers()
        .iter()
        .map(|n| NullifierData {
            nullifier: n.to_hex(),
        })
        .collect();

    // ── Account updates ───────────────────────────────────────────────────
    let account_updates: Vec<AccountUpdateData> = body
        .updated_accounts()
        .iter()
        .map(|u| AccountUpdateData {
            account_id: u.account_id().to_hex(),
            final_state: word_to_hex(u.final_state_commitment()),
            is_private: u.is_private(),
        })
        .collect();

    let tx_count = transactions.len();
    let note_count = notes.len();
    let nullifier_count = nullifiers.len();
    let account_update_count = account_updates.len();

    Ok(BlockDecoded {
        tx_count,
        note_count,
        nullifier_count,
        account_update_count,
        transactions,
        notes,
        nullifiers,
        account_updates,
    })
}
