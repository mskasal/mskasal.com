pub mod rooms;

use std::net::SocketAddr;

use askama::Template;
use axum::{
    extract::{ws::WebSocket, ConnectInfo, Path, Query, State, WebSocketUpgrade},
    response::IntoResponse,
    routing::get,
    Router,
};
use axum_extra::{headers, TypedHeader};
use serde::Deserialize;
use tower_http::{
    compression::{CompressionLayer, DefaultPredicate},
    services::{ServeDir, ServeFile},
    trace::{DefaultMakeSpan, TraceLayer},
};

#[derive(Clone)]
struct AppState {
    size: u32,
}

#[derive(Template)]
#[template(path = "index.html")]
pub struct IndexTemplate {}

#[derive(Template)]
#[template(path = "pong.html")]
pub struct PongTemplate {}

#[derive(Template)]
#[template(path = "ocr.html")]
pub struct OcrTemplate {}

#[derive(Template)]
#[template(path = "led_matrix.html")]
pub struct LedMatrixTemplate {}

#[derive(Template)]
#[template(path = "dyn_matrix.html")]
pub struct DynMatrixTemplate {
    size: u32,
}

#[derive(Template)]
#[template(path = "dyn_item.html")]
pub struct DynItemTemplate {
    i: u32,
    j: u32,
}

#[derive(Template)]
#[template(path = "grid.html")]
pub struct GridTemplate {
    size: u32,
}

#[derive(Template)]
#[template(path = "experiments.html")]
pub struct ExperimentsTemplate {}

#[derive(Template)]
#[template(path = "blog.html")]
pub struct BlogTemplate {}

async fn index_handler() -> IndexTemplate {
    IndexTemplate {}
}

async fn pong_handler() -> PongTemplate {
    PongTemplate {}
}

async fn ocr_handler() -> OcrTemplate {
    OcrTemplate {}
}

async fn led_matrix_handler() -> LedMatrixTemplate {
    LedMatrixTemplate {}
}

async fn dyn_matrix_handler(State(state): State<AppState>) -> DynMatrixTemplate {
    DynMatrixTemplate { size: state.size }
}

async fn matrix_state_handler(Path((i, j)): Path<(u32, u32)>) -> DynItemTemplate {
    DynItemTemplate { i, j }
}

#[derive(Deserialize)]
struct SizeQuery {
    size: u32,
}

async fn matrix_size_handler(
    State(mut state): State<AppState>,
    new_size: Query<SizeQuery>,
) -> GridTemplate {
    state.size = new_size.size;
    GridTemplate { size: state.size }
}

async fn experiments_handler() -> ExperimentsTemplate {
    ExperimentsTemplate {}
}

async fn blog_handler() -> BlogTemplate {
    BlogTemplate {}
}

async fn socket_handler(mut socket: WebSocket, who: SocketAddr) {
    while let Some(message) = socket.recv().await {
        let message = if let Ok(message) = message {
            tracing::debug!("echo message from {who}");
            message
        } else {
            return;
        };

        if socket.send(message).await.is_err() {
            return;
        }
    }
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    user_agent: Option<TypedHeader<headers::UserAgent>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> impl IntoResponse {
    let user_agent = if let Some(TypedHeader(user_agent)) = user_agent {
        user_agent.to_string()
    } else {
        String::from("Unknown browser")
    };
    tracing::debug!("`{user_agent}` at {addr} connected to the echo socket");
    // Pong's messages are tiny; keep strangers from pushing large ones.
    ws.max_message_size(rooms::MAX_FRAME)
        .max_frame_size(rooms::MAX_FRAME)
        .on_upgrade(move |socket| socket_handler(socket, addr))
}

async fn healthz_handler() -> &'static str {
    "ok"
}

/// Builds the site's router with its state applied.
pub fn router() -> Router {
    let state = AppState { size: 40 };
    let room_routes = Router::new()
        .route("/ws/room/:id", get(rooms::room_ws))
        .with_state(rooms::Rooms::default());
    let comression_layer: CompressionLayer = CompressionLayer::new()
        .br(true)
        .gzip(true)
        .zstd(true)
        .compress_when(DefaultPredicate::new());

    Router::new()
        .route("/", get(index_handler))
        .route("/pong", get(pong_handler))
        .route("/ocr", get(ocr_handler))
        .route("/led_matrix", get(led_matrix_handler))
        .route("/dyn_matrix", get(dyn_matrix_handler))
        .route("/matrix/size", get(matrix_size_handler))
        .route("/matrix/:i/:j", get(matrix_state_handler))
        .route("/experiments", get(experiments_handler))
        .route("/blog", get(blog_handler))
        .route("/ws", get(ws_handler))
        .route("/healthz", get(healthz_handler))
        .with_state(state)
        .merge(room_routes)
        .nest_service("/favicon.ico", ServeFile::new("assets/favicon.ico"))
        .nest_service("/assets", ServeDir::new("assets"))
        .layer(comression_layer)
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(DefaultMakeSpan::default().include_headers(true)),
        )
}
