// Server/CLI use only. Never import this module into a browser component.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

export function createDatabase() {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is required for database commands.");
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
}
