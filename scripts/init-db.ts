import { closeDb } from "@/lib/db/mongo";
import { createVectorIndex, ensureStandardIndexes, inspectVectorIndex } from "@/lib/db/indexes";

const dimensionsArg = process.argv.find((a) => a.startsWith("--dimensions="));
const dimensions = Number(dimensionsArg?.split("=")[1] ?? 768);

async function main() {
  if (!Number.isInteger(dimensions) || dimensions < 1)
    throw new Error("--dimensions must be a positive integer");
  await ensureStandardIndexes();
  console.log("Standard indexes ensured.");
  const outcome = await createVectorIndex(dimensions);
  console.log(
    outcome === "created"
      ? `Vector search index creation requested (${dimensions} dimensions). Atlas builds it asynchronously.`
      : "Vector search index already exists.",
  );
  const status = await inspectVectorIndex(dimensions);
  console.log(`Vector index status: ${status.state} - ${status.message}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closeDb);
