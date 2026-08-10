import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep DB drivers out of the server bundle: PGlite loads a WASM asset at
  // runtime and pg resolves optional native deps — both break when bundled.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
};

export default nextConfig;
