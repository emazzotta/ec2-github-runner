jest.mock('@actions/core', () => ({
  getInput: jest.fn(),
  setOutput: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  warning: jest.fn(),
  setFailed: jest.fn(),
}));

jest.mock('@actions/github', () => ({
  context: { repo: { owner: 'test-owner', repo: 'test-repo' } },
  getOctokit: jest.fn(),
}));

const core = require('@actions/core');
const github = require('@actions/github');
const { loadGh } = require('./support/inputs');

function octokitReturning({ runners = [], request = jest.fn() } = {}) {
  const paginate = jest.fn().mockResolvedValue(runners);
  github.getOctokit.mockReturnValue({ paginate, request });
  return { paginate, request };
}

const runner = (id, name, status = 'online') => ({ id, name, status, labels: [{ name: 'abc12' }] });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('gh.js - getJitRunnerConfig', () => {
  it('should call the generate-jitconfig API and return the encoded config', async () => {
    const request = jest.fn().mockResolvedValue({
      data: { runner: { id: 123, name: 'ec2-abc12' }, encoded_jit_config: 'base64encodedconfig' },
    });
    octokitReturning({ request });
    const gh = loadGh({ 'use-jit': 'true' });

    const result = await gh.getJitRunnerConfig('abc12');

    expect(request).toHaveBeenCalledWith(
      'POST /repos/{owner}/{repo}/actions/runners/generate-jitconfig',
      expect.objectContaining({
        owner: 'test-owner',
        repo: 'test-repo',
        name: 'ec2-abc12',
        runner_group_id: 1,
        labels: ['abc12'],
        work_folder: '_work',
      })
    );
    expect(result).toEqual({ runnerId: 123, encodedJitConfig: 'base64encodedconfig' });
  });

  it('should rethrow when the JIT config API fails', async () => {
    octokitReturning({ request: jest.fn().mockRejectedValue(new Error('API error')) });
    const gh = loadGh({ 'use-jit': 'true' });

    await expect(gh.getJitRunnerConfig('abc12')).rejects.toThrow('API error');
    expect(core.error).toHaveBeenCalledWith('GitHub JIT runner configuration generation error');
  });
});

describe('gh.js - removeRunners', () => {
  const stopInputs = { 'mode': 'stop', 'label': 'abc12', 'ec2-instance-ids': '["i-aaa","i-bbb"]' };

  it('should remove every runner carrying the label', async () => {
    const { request } = octokitReturning({ runners: [runner(1, 'ec2-abc12-a'), runner(2, 'ec2-abc12-b')] });
    const gh = loadGh(stopInputs);

    await gh.removeRunners();

    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledWith(
      'DELETE /repos/{owner}/{repo}/actions/runners/{runner_id}',
      expect.objectContaining({ runner_id: 1 })
    );
    expect(request).toHaveBeenCalledWith(
      'DELETE /repos/{owner}/{repo}/actions/runners/{runner_id}',
      expect.objectContaining({ runner_id: 2 })
    );
  });

  it('should keep removing the remaining runners after one removal fails, then rethrow', async () => {
    const request = jest
      .fn()
      .mockRejectedValueOnce(new Error('runner 1 is busy'))
      .mockResolvedValueOnce({});
    octokitReturning({ runners: [runner(1, 'ec2-abc12-a'), runner(2, 'ec2-abc12-b')], request });
    const gh = loadGh(stopInputs);

    await expect(gh.removeRunners()).rejects.toThrow('runner 1 is busy');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('should skip removal when no runner carries the label', async () => {
    const { request } = octokitReturning({ runners: [] });
    const gh = loadGh(stopInputs);

    await gh.removeRunners();

    expect(request).not.toHaveBeenCalled();
  });
});

describe('gh.js - waitForRunnersRegistered', () => {
  // upstream reads these as `parseInt(x) || <default>`, so 0 would silently fall back to the default
  const QUIET_PERIOD_MS = 1000;
  const POLL_INTERVAL_MS = 1000;
  const TIMEOUT_MS = 60000;
  const fastPolling = {
    'startup-quiet-period-seconds': '1',
    'startup-retry-interval-seconds': '1',
    'startup-timeout-minutes': '1',
  };

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should resolve once every expected runner is online', async () => {
    octokitReturning({ runners: [runner(1, 'ec2-abc12-a'), runner(2, 'ec2-abc12-b')] });
    const gh = loadGh(fastPolling);

    const waiting = gh.waitForRunnersRegistered('abc12', 2, null);
    await jest.advanceTimersByTimeAsync(QUIET_PERIOD_MS + POLL_INTERVAL_MS);

    await expect(waiting).resolves.toBeUndefined();
  });

  it('should keep waiting while fewer runners than expected are online', async () => {
    octokitReturning({ runners: [runner(1, 'ec2-abc12-a')] });
    const gh = loadGh(fastPolling);

    const waiting = gh.waitForRunnersRegistered('abc12', 2, null);
    waiting.catch(() => {});
    await jest.advanceTimersByTimeAsync(QUIET_PERIOD_MS + POLL_INTERVAL_MS);

    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('1/2 online'));
  });

  it('should reject with the online count when the timeout is exceeded', async () => {
    octokitReturning({ runners: [runner(1, 'ec2-abc12-a')] });
    const gh = loadGh(fastPolling);

    const waiting = gh.waitForRunnersRegistered('abc12', 2, null);
    const rejection = expect(waiting).rejects.toContain('Only 1 of 2 AWS EC2 instances registered themselves');
    await jest.advanceTimersByTimeAsync(QUIET_PERIOD_MS + TIMEOUT_MS + POLL_INTERVAL_MS);

    await rejection;
  });
});
