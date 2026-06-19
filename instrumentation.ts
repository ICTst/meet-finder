export async function register() {
  // Langfuse(観測)は環境変数キーがある時だけ有効化する。
  // 本番(Vercel)でキーを設定しなければ何もしない＝観測オフでも安全に起動する。
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.LANGFUSE_PUBLIC_KEY) {
    const { LangfuseSpanProcessor } = await import("@langfuse/otel");
    const { NodeTracerProvider } = await import("@opentelemetry/sdk-trace-node");

    const provider = new NodeTracerProvider({
      spanProcessors: [new LangfuseSpanProcessor()],
    });
    provider.register();
  }
}