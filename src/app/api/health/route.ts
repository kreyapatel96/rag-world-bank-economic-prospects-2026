import { geminiConfig, ollamaConfig } from "@/lib/config/env";
import { documentsCollection } from "@/lib/db/collections";
import { inspectVectorIndex } from "@/lib/db/indexes";
import { checkEmbeddingModel } from "@/lib/embeddings/embedder";
import { errorResponse, json } from "@/lib/http/route";
import { listOllamaModels, modelIsInstalled } from "@/lib/ollama/client";

export const runtime = "nodejs";

async function ollamaStatus() {
  const { chatModel, baseUrl } = ollamaConfig();
  try {
    const installed = await listOllamaModels();
    const embedding = await checkEmbeddingModel();
    return {
      reachable: true,
      baseUrl,
      chatModel: chatModel
        ? { name: chatModel, installed: modelIsInstalled(installed, chatModel) }
        : { name: null, installed: false },
      embeddingModel: embedding,
    };
  } catch (error) {
    return {
      reachable: false,
      baseUrl,
      message: error instanceof Error ? error.message : "Ollama is not reachable",
    };
  }
}

export async function GET() {
  try {
    const documents = await documentsCollection();
    const [firstReady, ollama] = await Promise.all([
      documents.findOne({ status: "ready" }, { projection: { embeddingDimensions: 1 } }),
      ollamaStatus(),
    ]);
    const vectorIndex = await inspectVectorIndex(firstReady?.embeddingDimensions ?? undefined);
    const gemini = geminiConfig();
    return json({
      mongo: { connected: true },
      vectorIndex,
      gemini: { apiKeyConfigured: Boolean(gemini.apiKey), model: gemini.model ?? null },
      ollama,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
