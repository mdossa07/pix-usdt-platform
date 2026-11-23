import { Redis } from 'ioredis';
import { config } from '../config.js';

/**
 * Shared Redis connection for BullMQ workers and queue producers.
 * Uses maxRetriesPerRequest: null as required by BullMQ v5+.
 * Reuses the same REDIS_URL validated in app config.
 */
export function createQueueConnection(): Redis {
  return new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });
}