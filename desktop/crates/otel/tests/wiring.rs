//! The crate against a real HTTP server: every signal the client emits
//! must arrive as OTLP/HTTP JSON naming this component. The server is a
//! byte-capturing fixture (hyper, a real HTTP stack); what the test
//! trusts is our client's bytes, parsed as JSON and checked against the
//! OTLP shapes the node's receiver requires.

use std::convert::Infallible;
use std::sync::{Arc, Mutex};

use http_body_util::{BodyExt, Full};
use hyper::body::{Bytes, Incoming};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use opentelemetry::trace::{Span as _, Status, Tracer as _};
use tokio::net::TcpListener;
use tracing_subscriber::prelude::__tracing_subscriber_SubscriberExt as _;

type Captured = Arc<Mutex<Vec<(String, Vec<u8>)>>>;

async fn serve(listener: TcpListener, captured: Captured) {
    loop {
        let Ok((stream, _)) = listener.accept().await else {
            return;
        };
        let io = TokioIo::new(stream);
        let captured = captured.clone();
        tokio::spawn(async move {
            let _ = http1::Builder::new()
                .serve_connection(
                    io,
                    service_fn(move |request: Request<Incoming>| {
                        let captured = captured.clone();
                        async move {
                            let path = request.uri().path().to_owned();
                            let body = request
                                .into_body()
                                .collect()
                                .await
                                .expect("a readable body")
                                .to_bytes()
                                .to_vec();
                            captured
                                .lock()
                                .expect("the capture lock")
                                .push((path, body));
                            Ok::<_, Infallible>(
                                Response::builder()
                                    .status(StatusCode::OK)
                                    .header("content-type", "application/json")
                                    .body(Full::new(Bytes::from_static(b"{}")))
                                    .expect("the 200 reply"),
                            )
                        }
                    }),
                )
                .await;
        });
    }
}

fn service_named(body: &[u8], resource: &str) -> bool {
    let json: serde_json::Value = serde_json::from_slice(body).expect("OTLP/HTTP JSON");
    json[resource][0]["resource"]["attributes"]
        .as_array()
        .is_some_and(|attributes| {
            attributes.iter().any(|attribute| {
                attribute["key"] == "service.name" && attribute["value"]["stringValue"] == "shell"
            })
        })
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn emits_spans_metrics_and_logs_as_otlp_json() {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("a loopback port");
    let address = listener.local_addr().expect("the bound address");
    let captured: Captured = Arc::new(Mutex::new(Vec::new()));
    let server = tokio::spawn(serve(listener, captured.clone()));

    let endpoint = format!("http://{address}");
    let guard = muse_spark_otel::init(&endpoint, "shell").expect("the wiring");
    let subscriber = tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer().with_writer(std::io::sink))
        .with(guard.span_layer())
        .with(guard.logs_layer());
    tracing::subscriber::with_default(subscriber, || {
        let span = tracing::info_span!("render");
        let _entered = span.enter();
        tracing::error!("frame dropped");
    });
    let meter = opentelemetry::global::meter("test");
    let counter = meter.u64_counter("frames").build();
    counter.add(1, &[]);
    let tracer = opentelemetry::global::tracer("test");
    let mut failing = tracer.start("failing");
    failing.set_status(Status::error("broken pipe"));
    failing.end();
    guard.shutdown().expect("a clean shutdown");
    server.abort();

    let captured = captured.lock().expect("the capture lock");
    // A fixture refresh for the node's receiver suite: point
    // `OTLP_FIXTURE_DIR` at an empty directory and this writes one body
    // per signal, exactly as the exporters sent it. Off by default.
    if let Ok(dir) = std::env::var("OTLP_FIXTURE_DIR") {
        for (path, body) in captured.iter() {
            let name = path.trim_start_matches("/v1/");
            std::fs::write(format!("{dir}/{name}.json"), body).expect("the fixture write");
        }
    }
    let mut paths: Vec<&str> = captured.iter().map(|(path, _)| path.as_str()).collect();
    paths.sort_unstable();
    paths.dedup();
    assert_eq!(paths, ["/v1/logs", "/v1/metrics", "/v1/traces"]);
    for (path, body) in captured.iter() {
        let json: serde_json::Value = serde_json::from_slice(body).expect("OTLP/HTTP JSON");
        match path.as_str() {
            "/v1/traces" => {
                assert!(service_named(body, "resourceSpans"));
                let scopes = json["resourceSpans"][0]["scopeSpans"]
                    .as_array()
                    .expect("the scopes");
                let spans: Vec<&serde_json::Value> = scopes
                    .iter()
                    .flat_map(|scope| scope["spans"].as_array().into_iter().flatten())
                    .collect();
                assert!(spans.iter().any(|span| span["name"] == "render"));
                let failing = spans
                    .iter()
                    .find(|span| span["name"] == "failing")
                    .expect("the error span");
                // Prost sends the enum numerically; the spec's JSON mapping
                // (and Go senders) use "STATUS_CODE_ERROR". The node's receiver
                // takes both.
                assert_eq!(failing["status"]["code"], 2);
            }
            "/v1/metrics" => {
                assert!(service_named(body, "resourceMetrics"));
                assert_eq!(
                    json["resourceMetrics"][0]["scopeMetrics"][0]["metrics"][0]["name"],
                    "frames"
                );
            }
            "/v1/logs" => {
                assert!(service_named(body, "resourceLogs"));
                let record = &json["resourceLogs"][0]["scopeLogs"][0]["logRecords"][0];
                assert_eq!(record["body"]["stringValue"], "frame dropped");
                assert_eq!(record["severityNumber"], 17);
            }
            other => panic!("an unexpected OTLP route: {other}"),
        }
    }
}
