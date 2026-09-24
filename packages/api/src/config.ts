export interface Config {
  env: 'development' | 'test' | 'production';
  appUrl: string;
  /** ≥32 chars; used for HMAC signing and field encryption */
  appSecret: string;
  cronSecret: string | null;
  minAgentVersion: string;
  sessionTtlHours: number;
  /** allow signups without email verification (dev/demo only) */
  requireEmailVerification: boolean;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const nodeEnv = (env.NODE_ENV === 'production' ? 'production' : env.NODE_ENV === 'test' ? 'test' : 'development') as Config['env'];
  const appSecret = env.APP_SECRET ?? (nodeEnv === 'production' ? '' : 'dev-insecure-secret-change-me-0123456789abcdef');
  if (appSecret.length < 32) throw new Error('APP_SECRET must be set to at least 32 characters');
  const vercelUrl = env.VERCEL_PROJECT_PRODUCTION_URL ?? env.VERCEL_URL;
  return {
    env: nodeEnv,
    appUrl: (env.APP_URL ?? (vercelUrl ? `https://${vercelUrl}` : 'http://localhost:3000')).replace(/\/$/, ''),
    appSecret,
    cronSecret: env.CRON_SECRET ?? null,
    minAgentVersion: env.MIN_AGENT_VERSION ?? '0.1.0',
    sessionTtlHours: Number(env.SESSION_TTL_HOURS ?? 24 * 14),
    requireEmailVerification: env.REQUIRE_EMAIL_VERIFICATION === 'true',
  };
}
