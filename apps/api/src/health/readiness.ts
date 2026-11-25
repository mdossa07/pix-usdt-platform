export type ReadinessDependencies = {
  database: () => Promise<unknown>;
  redis: () => Promise<unknown>;
};

export type ReadinessResult = {
  ready: boolean;
  checks: {
    database: boolean;
    redis: boolean;
  };
};

async function succeeds(check: () => Promise<unknown>): Promise<boolean> {
  try {
    await check();
    return true;
  } catch {
    return false;
  }
}

/**
 * Reports only dependency availability, never raw connection errors or secrets.
 * Liveness stays independent; readiness requires both PostgreSQL and Redis.
 */
export async function checkApplicationReadiness(
  dependencies: ReadinessDependencies,
): Promise<ReadinessResult> {
  const [database, redis] = await Promise.all([
    succeeds(dependencies.database),
    succeeds(dependencies.redis),
  ]);

  return {
    ready: database && redis,
    checks: { database, redis },
  };
}
