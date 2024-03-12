use std::net::SocketAddr;

use askama::Template;
use axum::{
    extract::{ws::WebSocket, ConnectInfo, Path, State, WebSocketUpgrade},
    response::IntoResponse,
    routing::get,
    Router,
};
use axum_extra::{headers, TypedHeader};
use tower_http::{
    compression::{CompressionLayer, DefaultPredicate},
    services::{ServeDir, ServeFile},
    trace::{DefaultMakeSpan, TraceLayer},
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[derive(Clone)]
struct AppState {
    matrix: Vec<Vec<u8>>,
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
    matrix: Vec<Vec<u8>>,
}

#[derive(Template)]
#[template(path = "dyn_item.html")]
pub struct DynItemTemplate {
    i: u32,
    j: u32,
}

#[derive(Template)]
#[template(path = "dyn_item_idle.html")]
pub struct DynItemIdleTemplate {
    i: u32,
    j: u32,
}

#[derive(Template)]
#[template(path = "experiments.html")]
pub struct ExperimentsTemplate {}

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
    DynMatrixTemplate {
        size: state.size,
        matrix: state.matrix,
    }
}

async fn matrix_state_handler(Path((i, j)): Path<(u32, u32)>) -> impl IntoResponse {
    DynItemTemplate { i, j }
}

async fn matrix_state_idle_handler(Path((i, j)): Path<(u32, u32)>) -> impl IntoResponse {
    DynItemTemplate { i, j }
}

async fn experiments_handler() -> ExperimentsTemplate {
    ExperimentsTemplate {}
}

async fn socket_handler(mut socket: WebSocket, who: SocketAddr) {
    while let Some(message) = socket.recv().await {
        let message = if let Ok(message) = message {
            println!("Message received {who}...");
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
    println!("`{user_agent}` at {addr} connected.");
    ws.on_upgrade(move |socket| socket_handler(socket, addr))
}

#[tokio::main(flavor = "multi_thread")]
async fn main() {
    let state = AppState {
        matrix: vec![vec![0; 40]; 40],
        size: 40,
    };
    let comression_layer: CompressionLayer = CompressionLayer::new()
        .br(true)
        .gzip(true)
        .zstd(true)
        .compress_when(DefaultPredicate::new());

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "example_websockets=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let app = Router::new()
        .route("/", get(index_handler))
        .route("/pong", get(pong_handler))
        .route("/ocr", get(ocr_handler))
        .route("/led_matrix", get(led_matrix_handler))
        .route("/dyn_matrix", get(dyn_matrix_handler))
        .route("/matrix/idle/:i/:j", get(matrix_state_idle_handler))
        .route("/matrix/:i/:j", get(matrix_state_handler))
        .route("/experiments", get(experiments_handler))
        .route("/ws", get(ws_handler))
        .with_state(state)
        .nest_service("/favicon.ico", ServeFile::new("assets/favicon.ico"))
        .nest_service("/assets", ServeDir::new("assets"))
        .layer(comression_layer)
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(DefaultMakeSpan::default().include_headers(true)),
        );

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await.unwrap();
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .unwrap();
}
