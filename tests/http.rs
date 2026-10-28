mod common;

#[tokio::test]
async fn healthz_returns_ok() {
    let addr = common::spawn().await;
    let res = reqwest::get(format!("http://{addr}/healthz")).await.unwrap();
    assert_eq!(res.status(), 200);
    assert_eq!(res.text().await.unwrap(), "ok");
}

#[tokio::test]
async fn index_has_cv_root_and_no_phone() {
    let addr = common::spawn().await;
    let body = reqwest::get(format!("http://{addr}/"))
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(body.contains(r#"<main id="cv""#));
    assert!(body.contains("mustafasamedkasal@gmail.com"));
    assert!(!body.contains("+49174"));
    // The 2025 PDF still carries the phone number; it stays off the site
    // until a phone-free PDF replaces it.
    assert!(!body.contains(".pdf"));
}
