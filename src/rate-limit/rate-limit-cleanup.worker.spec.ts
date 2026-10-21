import { ConfigService } from '@nestjs/config';
import { RateLimitCleanupWorker } from './rate-limit-cleanup.worker';
import { RateLimitService } from './rate-limit.service';

const makeConfig = (env: Record<string, string | undefined>) =>
  ({
    get: (key: string, def?: unknown) => env[key] ?? def,
  }) as unknown as ConfigService;

describe('RateLimitCleanupWorker', () => {
  let rateLimitService: { cleanupOldRecords: jest.Mock };
  let worker: RateLimitCleanupWorker | undefined;

  const build = (env: Record<string, string | undefined>) =>
    new RateLimitCleanupWorker(
      rateLimitService as unknown as RateLimitService,
      makeConfig(env),
    );

  beforeEach(() => {
    rateLimitService = { cleanupOldRecords: jest.fn() };
    worker = undefined;
  });

  afterEach(() => {
    worker?.onModuleDestroy();
  });

  describe('deny-by-default', () => {
    it.each([undefined, 'false'])(
      'is disabled when RATE_LIMIT_CLEANUP_ENABLED is %p',
      async (flag) => {
        worker = build({ RATE_LIMIT_CLEANUP_ENABLED: flag });

        await expect(worker.run()).resolves.toBe(0);
        expect(rateLimitService.cleanupOldRecords).not.toHaveBeenCalled();
      },
    );
  });

  describe('re-entrancy guard', () => {
    it('skips an overlapping run while a previous pass is in flight', async () => {
      worker = build({ RATE_LIMIT_CLEANUP_ENABLED: 'true' });

      let resolveFirst!: (n: number) => void;
      rateLimitService.cleanupOldRecords.mockReturnValueOnce(
        new Promise<number>((resolve) => {
          resolveFirst = resolve;
        }),
      );

      const first = worker.run();
      const second = await worker.run();

      expect(second).toBe(0);
      expect(rateLimitService.cleanupOldRecords).toHaveBeenCalledTimes(1);

      resolveFirst(5);
      await expect(first).resolves.toBe(5);
    });
  });

  describe('fail-closed, non-fatal', () => {
    it('resolves to 0 when cleanupOldRecords rejects', async () => {
      worker = build({ RATE_LIMIT_CLEANUP_ENABLED: 'true' });
      rateLimitService.cleanupOldRecords.mockRejectedValueOnce(
        new Error('database unavailable'),
      );

      await expect(worker.run()).resolves.toBe(0);
    });
  });
});
