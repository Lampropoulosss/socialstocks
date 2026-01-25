import "dotenv/config";
import { defineConfig } from "prisma/config";

const databaseUrl = process.env.DATABASE_URL;

const config = defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // If DATABASE_URL is missing (e.g. during build without env), provide a dummy valid URL
    // to allow 'prisma generate' to succeed.
    url: databaseUrl || "postgresql://dummy:dummy@localhost:5432/dummy",
  },
});

console.log("DEBUG: Config object datasource.url:", config.datasource?.url);

export default config;
