use askama::Template;
use axum::{routing::get, Router};
use tower_http::services::ServeDir;

#[derive(Template)]
#[template(path = "index.html")]
pub struct IndexTemplate {}

#[derive(Template)]
#[template(path = "pong.html")]
pub struct PongTemplate {}

#[derive(Template)]
#[template(path = "experiments.html")]
pub struct ExperimentsTemplate {}

async fn index_handler() -> IndexTemplate {
    IndexTemplate {}
}

async fn pong_handler() -> PongTemplate {
    PongTemplate {}
}

async fn experiments_handler() -> ExperimentsTemplate {
    ExperimentsTemplate {}
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    let app = Router::new()
        .route("/", get(index_handler))
        .route("/pong", get(pong_handler))
        .route("/experiments", get(experiments_handler))
        .nest_service("/assets", ServeDir::new("assets"));
    let listener = tokio::net::TcpListener::bind("0.0.0.0:6969").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
