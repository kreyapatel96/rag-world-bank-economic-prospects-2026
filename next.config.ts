import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["unpdf", "pdfjs-dist", "mongodb"],
  outputFileTracingIncludes: {
    "/api/evaluate": ["./data/eval/**/*"],
  },
};

export default config;
