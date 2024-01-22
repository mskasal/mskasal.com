use askama::Template;
use axum::{routing::get, Router};
use tower_http::services::ServeDir;

#[derive(Template)]
#[template(path = "index.html")]
pub struct IndexTemplate {}

async fn index_handler() -> IndexTemplate {
    IndexTemplate {}
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    let app = Router::new()
        .route("/", get(index_handler))
        .nest_service("/assets", ServeDir::new("assets"));
    let listener = tokio::net::TcpListener::bind("0.0.0.0:6969").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
