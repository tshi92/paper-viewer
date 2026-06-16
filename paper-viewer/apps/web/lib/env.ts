import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(16),
  APP_URL: z.string().url(),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("true"),
  MAX_PDF_UPLOAD_MB: z.coerce.number().int().positive().default(50),
  INGEST_API_KEY: z.string().min(16),
  RESEND_API_KEY: z.string().min(1).optional(),
  LLM_API_KEY: z.string().min(1),
  LLM_BASE_URL: z.string().url().default("https://api.moonshot.cn/v1"),
  LLM_MODEL: z.string().default("moonshot-v1-128k")
});

type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (!cached) {
    cached = envSchema.parse(process.env);
  }
  return cached;
}

export { type Env };
