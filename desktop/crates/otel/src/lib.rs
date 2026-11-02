//! OpenTelemetry wiring for Muse Desktop's Rust surfaces (M111 lane OB,
//! PLAN.md D91.22, research 11).
//!
//! The shell, the compositor and their siblings send metrics, logs and
//! traces to the node's local OTLP/HTTP receiver, which keeps them on the
//! box in its ring store. Export to the person's own collector is the
//! runtime exporter's business, over TLS, only after they switch it on:
//! this crate speaks plain OTLP/HTTP JSON to loopback and refuses
//! anything else.
//!
//! One call wires everything: [`init`] validates the endpoint and the
//! component name, builds the tracer, meter and logger providers around
//! OTLP/HTTP JSON exporters, and installs the tracer and meter as the
//! process globals (the logger rides the [`OtelGuard::logs_layer`]).
//! The [`OtelGuard`] it returns flushes and shuts the providers down,
//! and hands out the `tracing` bridge layers for hosts that instrument
//! with `tracing`. Rust panics become structured crash records through
//! [`crash::install_panic_hook`], in the ring's own line format.
//!
//! Call [`init`] once per process, inside a Tokio runtime (the batch
//! processors export on it), and [`OtelGuard::shutdown`] once before
//! the runtime goes away.

#![forbid(unsafe_code)]

pub mod crash;

pub use crash::install_panic_hook;

use std::error::Error;
use std::fmt;

use opentelemetry::global;
use opentelemetry::trace::TracerProvider as _;
use opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge;
use opentelemetry_otlp::{LogExporter, MetricExporter, Protocol, SpanExporter, WithExportConfig};
use opentelemetry_sdk::logs::log_processor_with_async_runtime::BatchLogProcessor as AsyncBatchLogProcessor;
use opentelemetry_sdk::logs::{SdkLogger, SdkLoggerProvider};
use opentelemetry_sdk::metrics::periodic_reader_with_async_runtime::PeriodicReader as AsyncPeriodicReader;
use opentelemetry_sdk::metrics::SdkMeterProvider;
use opentelemetry_sdk::runtime;
use opentelemetry_sdk::trace::span_processor_with_async_runtime::BatchSpanProcessor as AsyncBatchSpanProcessor;
use opentelemetry_sdk::trace::{SdkTracer, SdkTracerProvider};
use opentelemetry_sdk::Resource;
use tracing_subscriber::registry::LookupSpan;

/// The local receiver's port, mirroring `O11Y_RECEIVER_PORT`
/// (`src/shared/constants.ts`): OTLP's own default, loopback only.
pub const RECEIVER_PORT: u16 = 4318;

/// Every component that may send telemetry, mirroring
/// `O11Y_COMPONENTS` (`src/core/o11y/signals.ts`): anything else is
/// refused at [`init`] and at [`install_panic_hook`].
pub const COMPONENTS: &[&str] = &[
    "compositor",
    "shell",
    "sysd",
    "app-main",
    "app-renderer",
    "node",
    "tool-host",
    "installer",
    "admin-helper",
    "companion",
    "tui",
];

/// Why [`init`] refused: fixed words, never the refused value.
#[derive(Debug)]
pub enum InitError {
    /// The endpoint is not plain `http` on a loopback host without a path.
    BadEndpoint,
    /// The component is outside [`COMPONENTS`].
    UnknownComponent,
    /// No Tokio runtime is running here; the batch processors need one.
    NoRuntime,
    /// An exporter or provider failed to build; the source says more.
    Build(String),
}

impl fmt::Display for InitError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::BadEndpoint => write!(f, "otel endpoint is not plain http on loopback"),
            Self::UnknownComponent => write!(f, "otel component is unknown"),
            Self::NoRuntime => write!(f, "otel init needs a running tokio runtime"),
            Self::Build(message) => write!(f, "otel provider failed to build: {message}"),
        }
    }
}

impl Error for InitError {}

/// Why [`OtelGuard::shutdown`] failed: which provider, in fixed words.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShutdownError {
    /// The tracer provider did not shut down.
    Tracer,
    /// The meter provider did not shut down.
    Meter,
    /// The logger provider did not shut down.
    Logger,
}

impl fmt::Display for ShutdownError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Tracer => write!(f, "otel tracer provider did not shut down"),
            Self::Meter => write!(f, "otel meter provider did not shut down"),
            Self::Logger => write!(f, "otel logger provider did not shut down"),
        }
    }
}

impl Error for ShutdownError {}

fn endpoint_ok(endpoint: &str) -> bool {
    let url = url::Url::parse(endpoint);
    let Ok(url) = url else {
        return false;
    };
    if url.scheme() != "http" {
        return false;
    }
    if url.path() != "/" && !url.path().is_empty() {
        return false;
    }
    // `host_str` keeps IPv6 brackets; `localhost` arrives lowercased.
    matches!(url.host_str(), Some("127.0.0.1" | "[::1]" | "localhost"))
}

/// The wired providers. Shut them down once, before the runtime goes
/// away; shutting down flushes every buffered span, metric and log.
#[derive(Debug)]
pub struct OtelGuard {
    tracer: SdkTracerProvider,
    meter: SdkMeterProvider,
    logger: SdkLoggerProvider,
}

impl OtelGuard {
    /// Flush every provider and shut them down. Each provider is attempted
    /// even when an earlier one fails; the first failure is returned.
    ///
    /// # Errors
    ///
    /// [`ShutdownError`] naming the first provider that did not shut down.
    pub fn shutdown(&self) -> Result<(), ShutdownError> {
        let tracer = self.tracer.shutdown().err().map(|_| ShutdownError::Tracer);
        let meter = self.meter.shutdown().err().map(|_| ShutdownError::Meter);
        let logger = self.logger.shutdown().err().map(|_| ShutdownError::Logger);
        tracer.or(meter).or(logger).map_or(Ok(()), Err)
    }

    /// The `tracing` span layer over this guard's tracer: spans the host
    /// opens become OTLP spans. Compose it into the host's subscriber.
    #[must_use]
    pub fn span_layer<S>(&self) -> tracing_opentelemetry::OpenTelemetryLayer<S, SdkTracer>
    where
        S: tracing::Subscriber + for<'span> LookupSpan<'span>,
    {
        tracing_opentelemetry::layer().with_tracer(self.tracer.tracer("muse-spark-otel"))
    }

    /// The `tracing` event layer over this guard's logger: events become
    /// OTLP log records. Compose it into the host's subscriber.
    #[must_use]
    pub fn logs_layer(&self) -> OpenTelemetryTracingBridge<SdkLoggerProvider, SdkLogger> {
        OpenTelemetryTracingBridge::new(&self.logger)
    }
}

/// Wire OpenTelemetry for one component: validate the endpoint and the
/// name, build the three providers around OTLP/HTTP JSON exporters to
/// the local receiver, and install them as the process globals.
///
/// The endpoint must be plain `http` on a loopback host (`127.0.0.1`,
/// `::1`, `localhost`) with no path; the exporters append the OTLP
/// routes themselves. Anything else is refused: telemetry never leaves
/// the box from here.
///
/// Call once per process, inside a multi-thread Tokio runtime: the
/// async-runtime processors export on it, and Tokio's current-thread
/// scheduler can hang a shutdown forever (the SDK's own warning).
///
/// ```rust
/// let error = muse_spark_otel::init("https://otel.example:4318", "shell")
///   .expect_err("a remote collector is refused");
/// assert!(matches!(error, muse_spark_otel::InitError::BadEndpoint));
/// ```
///
/// # Errors
///
/// [`InitError::BadEndpoint`] when the endpoint is not plain HTTP on
/// loopback, [`InitError::UnknownComponent`] when the name is outside
/// [`COMPONENTS`], [`InitError::NoRuntime`] without a running Tokio
/// runtime, [`InitError::Build`] when an exporter or provider fails.
pub fn init(endpoint: &str, service_name: &str) -> Result<OtelGuard, InitError> {
    if !endpoint_ok(endpoint) {
        return Err(InitError::BadEndpoint);
    }
    if !COMPONENTS.contains(&service_name) {
        return Err(InitError::UnknownComponent);
    }
    if tokio::runtime::Handle::try_current().is_err() {
        return Err(InitError::NoRuntime);
    }
    let resource = Resource::builder()
        .with_service_name(service_name.to_owned())
        .build();
    // The exporters post to the endpoint verbatim, so each signal names
    // its OTLP route; the endpoint itself carries no path by validation.
    let base = endpoint.trim_end_matches('/');
    let spans = SpanExporter::builder()
        .with_http()
        .with_protocol(Protocol::HttpJson)
        .with_endpoint(format!("{base}/v1/traces"))
        .build()
        .map_err(|error| InitError::Build(error.to_string()))?;
    let metrics = MetricExporter::builder()
        .with_http()
        .with_protocol(Protocol::HttpJson)
        .with_endpoint(format!("{base}/v1/metrics"))
        .build()
        .map_err(|error| InitError::Build(error.to_string()))?;
    let logs = LogExporter::builder()
        .with_http()
        .with_protocol(Protocol::HttpJson)
        .with_endpoint(format!("{base}/v1/logs"))
        .build()
        .map_err(|error| InitError::Build(error.to_string()))?;
    // The async-runtime processors: the runtime-agnostic batchers run
    // exports on their own threads, where the HTTP exporter's Tokio client
    // has no reactor. These drive exports on the host runtime instead.
    let spans = AsyncBatchSpanProcessor::builder(spans, runtime::Tokio).build();
    let tracer = SdkTracerProvider::builder()
        .with_resource(resource.clone())
        .with_span_processor(spans)
        .build();
    let reader = AsyncPeriodicReader::builder(metrics, runtime::Tokio).build();
    let meter = SdkMeterProvider::builder()
        .with_resource(resource.clone())
        .with_reader(reader)
        .build();
    let logs = AsyncBatchLogProcessor::builder(logs, runtime::Tokio).build();
    let logger = SdkLoggerProvider::builder()
        .with_resource(resource)
        .with_log_processor(logs)
        .build();
    global::set_tracer_provider(tracer.clone());
    global::set_meter_provider(meter.clone());
    // The logger stays off the process globals (the SDK sets none):
    // hosts emit through `logs_layer`, tied to this guard's lifetime.
    Ok(OtelGuard {
        tracer,
        meter,
        logger,
    })
}

#[cfg(test)]
mod tests {
    use super::{endpoint_ok, init, InitError, COMPONENTS};

    #[test]
    fn refuses_endpoints_off_the_box() {
        assert!(endpoint_ok("http://127.0.0.1:4318"));
        assert!(endpoint_ok("http://localhost:4318/"));
        assert!(endpoint_ok("http://[::1]:4318"));
        assert!(endpoint_ok("http://127.0.0.1:0"));
        assert!(!endpoint_ok("https://127.0.0.1:4318"));
        assert!(!endpoint_ok("http://otel.example:4318"));
        assert!(!endpoint_ok("http://192.168.1.2:4318"));
        assert!(!endpoint_ok("http://127.0.0.1:4318/v1/traces"));
        assert!(!endpoint_ok("not a url"));
    }

    #[test]
    fn components_mirror_the_receiver() {
        assert_eq!(COMPONENTS.len(), 11);
        for name in ["compositor", "shell", "sysd", "app-main", "app-renderer"] {
            assert!(COMPONENTS.contains(&name));
        }
    }

    #[test]
    fn init_names_its_refusals() {
        let error =
            init("http://127.0.0.1:4318", "toaster").expect_err("an unknown component is refused");
        assert!(matches!(error, InitError::UnknownComponent));
        let error = init("http://otel.example:4318", "shell").expect_err("off-box is refused");
        assert!(matches!(error, InitError::BadEndpoint));
    }

    #[test]
    fn errors_read_in_fixed_words() {
        assert_eq!(
            InitError::BadEndpoint.to_string(),
            "otel endpoint is not plain http on loopback"
        );
        assert_eq!(
            super::ShutdownError::Meter.to_string(),
            "otel meter provider did not shut down"
        );
    }
}
