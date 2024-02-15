use askama::Template;
use axum::{routing::get, Router};
use tower_http::{
    compression::{CompressionLayer, DefaultPredicate},
    services::{ServeDir, ServeFile},
};

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

async fn experiments_handler() -> ExperimentsTemplate {
    ExperimentsTemplate {}
}

#[tokio::main]
async fn main() {
    let comression_layer: CompressionLayer = CompressionLayer::new()
        .br(true)
        .gzip(true)
        .zstd(true)
        .compress_when(DefaultPredicate::new());

    tracing_subscriber::fmt::init();

    let app = Router::new()
        .route("/", get(index_handler))
        .route("/pong", get(pong_handler))
        .route("/ocr", get(ocr_handler))
        .route("/led_matrix", get(led_matrix_handler))
        .route("/experiments", get(experiments_handler))
        .nest_service("/favicon.ico", ServeFile::new("assets/favicon.ico"))
        .nest_service("/assets", ServeDir::new("assets"))
        .layer(comression_layer);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3300").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
