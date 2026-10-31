import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import * as OtlpSerialization from "effect/observability/OtlpSerialization";
import * as OtlpTracer from "effect/observability/OtlpTracer";

/**
 * Export spans over OTLP/HTTP. Without both `OTEL_TRACES_EXPORTER=otlp` and
 * `OTEL_EXPORTER_OTLP_ENDPOINT` this adds nothing, so tests and `next build` need no collector. Traces only: the cluster's collector has no
 * logs or metrics pipeline; logs go to Loki from stdout.
 */
export const Telemetry = (serviceName: string) =>
  OtlpTracer.layerFromConfig({ resource: { serviceName } }).pipe(
    Layer.provide(OtlpSerialization.layerJson),
    Layer.provide(FetchHttpClient.layer),
  );
