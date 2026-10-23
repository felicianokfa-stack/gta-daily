import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Painel autenticado: todas as páginas leem o banco a cada requisição (export const dynamic = "force-dynamic").
  // Drivers de banco rodam só no servidor e não devem ser empacotados.
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
