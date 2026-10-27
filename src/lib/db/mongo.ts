import { MongoClient, type Db } from "mongodb";
import { requireMongoEnv } from "@/lib/config/env";
import { AppError } from "@/lib/http/errors";

const globalForMongo = globalThis as unknown as { mongoClientPromise?: Promise<MongoClient> };

function getClientPromise(): Promise<MongoClient> {
  if (!globalForMongo.mongoClientPromise) {
    const { uri } = requireMongoEnv();
    const client = new MongoClient(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 8000,
      appName: "worldbank-rag",
    });
    globalForMongo.mongoClientPromise = client.connect().catch((error: unknown) => {
      globalForMongo.mongoClientPromise = undefined;
      throw error;
    });
  }
  return globalForMongo.mongoClientPromise;
}

export async function getDb(): Promise<Db> {
  const { dbName } = requireMongoEnv();
  try {
    const client = await getClientPromise();
    return client.db(dbName);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "database_error",
      "Could not connect to MongoDB. Check MONGODB_URI, network access and credentials.",
      503,
    );
  }
}

export async function closeDb() {
  const promise = globalForMongo.mongoClientPromise;
  globalForMongo.mongoClientPromise = undefined;
  if (promise) await (await promise).close();
}
