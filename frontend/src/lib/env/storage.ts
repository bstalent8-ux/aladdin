import "server-only";
import { z } from "zod";

const optional = z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional());
export const storageEnvSchema = z.object({
  R2_STORAGE_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  R2_PRODUCTION_WRITES_APPROVED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  R2_ACCOUNT_ID: z.preprocess((value) => value === "" ? undefined : value, z.string().regex(/^[a-f0-9]{32}$/).optional()),
  R2_ACCESS_KEY_ID: optional,
  R2_SECRET_ACCESS_KEY: optional,
  R2_PUBLIC_BUCKET: optional,
  R2_PRIVATE_BUCKET: optional,
  R2_PUBLIC_BASE_URL: z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional()),
  SUPABASE_SERVICE_ROLE_KEY: optional,
}).superRefine((env, ctx) => {
  if (env.R2_PUBLIC_BASE_URL && !env.R2_PUBLIC_BASE_URL.startsWith("https://")) {
    ctx.addIssue({ code: "custom", path: ["R2_PUBLIC_BASE_URL"], message: "Public media must use HTTPS" });
  }
  if (env.R2_PUBLIC_BUCKET && env.R2_PUBLIC_BUCKET === env.R2_PRIVATE_BUCKET) {
    ctx.addIssue({ code: "custom", path: ["R2_PRIVATE_BUCKET"], message: "Public and private buckets must differ" });
  }
  if (env.R2_STORAGE_ENABLED) {
    for (const name of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_PRIVATE_BUCKET", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
      if (!env[name]) ctx.addIssue({ code: "custom", path: [name], message: "Required for R2 writes" });
    }
  }
});

export function readStorageEnv() {
  return storageEnvSchema.parse({
    R2_STORAGE_ENABLED: process.env.R2_STORAGE_ENABLED,
    R2_PRODUCTION_WRITES_APPROVED: process.env.R2_PRODUCTION_WRITES_APPROVED,
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_PUBLIC_BUCKET: process.env.R2_PUBLIC_BUCKET,
    R2_PRIVATE_BUCKET: process.env.R2_PRIVATE_BUCKET,
    R2_PUBLIC_BASE_URL: process.env.R2_PUBLIC_BASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
}
