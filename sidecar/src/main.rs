mod decode;

use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::post;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use tracing::{error, info};

// ── Request / Response ──────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct DecodeRequest {
    block_num: u32,
    /// Raw block bytes, hex-encoded (no "0x" prefix).
    bytes: String,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status")]
enum DecodeResponse {
    #[serde(rename = "ok")]
    Ok(decode::BlockDecoded),
    #[serde(rename = "error")]
    Error { message: String },
}

// ── Handler ─────────────────────────────────────────────────────────────────

async fn decode_handler(
    Json(req): Json<DecodeRequest>,
) -> impl IntoResponse {
    let raw = match hex::decode(&req.bytes) {
        Ok(b) => b,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(DecodeResponse::Error {
                    message: format!("hex decode error: {e}"),
                }),
            );
        }
    };

    if raw.is_empty() {
        // Empty bytes — block has no body (occurs in some testnet blocks).
        return (
            StatusCode::OK,
            Json(DecodeResponse::Ok(decode::BlockDecoded {
                tx_count: 0,
                note_count: 0,
                nullifier_count: 0,
                account_update_count: 0,
                transactions: vec![],
                notes: vec![],
                nullifiers: vec![],
                account_updates: vec![],
            })),
        );
    }

    match decode::decode_block(req.block_num, &raw) {
        Ok(decoded) => {
            info!(
                block_num = req.block_num,
                tx_count = decoded.tx_count,
                note_count = decoded.note_count,
                nullifier_count = decoded.nullifier_count,
                "decoded block"
            );
            (StatusCode::OK, Json(DecodeResponse::Ok(decoded)))
        }
        Err(msg) => {
            error!(block_num = req.block_num, error = %msg, "decode failed");
            (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(DecodeResponse::Error { message: msg }),
            )
        }
    }
}

async fn health_handler() -> impl IntoResponse {
    StatusCode::OK
}

// ── Main ────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG")
                .unwrap_or_else(|_| "miden_decoder=info".to_string()),
        )
        .json()
        .init();

    let port: u16 = std::env::var("DECODER_PORT")
        .unwrap_or_else(|_| "4000".to_string())
        .parse()
        .expect("DECODER_PORT must be a valid port number");

    let addr = SocketAddr::from(([0, 0, 0, 0], port));

    let app = Router::new()
        .route("/decode", post(decode_handler))
        .route("/health", axum::routing::get(health_handler));

    info!(%addr, "miden-decoder sidecar listening");

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("failed to bind listener");

    axum::serve(listener, app)
        .await
        .expect("server error");
}
