export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { LangfuseSpanProcessor } = await import("@langfuse/otel");
    const { NodeTracerProvider } = await import("@opentelemetry/sdk-trace-node");

    const provider = new NodeTracerProvider({
      spanProcessors: [new LangfuseSpanProcessor()],
    });
    provider.register();
  }
}