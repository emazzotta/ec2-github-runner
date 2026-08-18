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
const { createConfig } = require('./support/inputs');

describe('Config - instance count', () => {
  it('should default the instance count to one', () => {
    expect(createConfig().input.ec2InstanceCount).toBe(1);
  });

  it('should read a custom instance count as a number', () => {
    expect(createConfig({ 'ec2-instance-count': '5' }).input.ec2InstanceCount).toBe(5);
  });

  it('should throw when the instance count is not a positive integer', () => {
    expect(() => createConfig({ 'ec2-instance-count': '0' })).toThrow("The 'ec2-instance-count' input must be a positive integer");
    expect(() => createConfig({ 'ec2-instance-count': 'many' })).toThrow("The 'ec2-instance-count' input must be a positive integer");
  });

  it('should throw when use-jit is combined with more than one instance', () => {
    expect(() => createConfig({ 'use-jit': 'true', 'ec2-instance-count': '2' })).toThrow(
      'A JIT configuration registers exactly one runner'
    );
  });

  it('should allow use-jit with a single instance', () => {
    expect(() => createConfig({ 'use-jit': 'true', 'ec2-instance-count': '1' })).not.toThrow();
  });
});

describe('Config - instance ids', () => {
  it('should parse the instance ids as JSON in stop mode', () => {
    const config = createConfig({ 'mode': 'stop', 'label': 'abc12', 'ec2-instance-ids': '["i-aaa","i-bbb"]' });
    expect(config.input.ec2InstanceIds).toEqual(['i-aaa', 'i-bbb']);
  });

  it('should throw in stop mode when no instance ids are supplied', () => {
    expect(() => createConfig({ 'mode': 'stop', 'label': 'abc12' })).toThrow("The 'ec2-instance-ids' input is required for the 'stop' mode");
  });

  it('should warn in stop mode when the label is missing', () => {
    createConfig({ 'mode': 'stop', 'ec2-instance-ids': '["i-aaa"]' });
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('runners cannot be removed from GitHub'));
  });

  it('should default the instance ids to an empty list in start mode', () => {
    expect(createConfig().input.ec2InstanceIds).toEqual([]);
  });
});

describe('Config - shutdown behaviour', () => {
  it('should default the shutdown behaviour to stop', () => {
    expect(createConfig().input.instanceInitiatedShutdownBehavior).toBe('stop');
  });

  it('should read a custom shutdown behaviour', () => {
    const config = createConfig({ 'instance-initiated-shutdown-behavior': 'terminate' });
    expect(config.input.instanceInitiatedShutdownBehavior).toBe('terminate');
  });
});

describe('Config - JIT inputs', () => {
  it('should read useJit as false by default', () => {
    expect(createConfig().input.useJit).toBe(false);
  });

  it('should read useJit as true when set', () => {
    expect(createConfig({ 'use-jit': 'true' }).input.useJit).toBe(true);
  });

  it('should default the runner group id to one', () => {
    expect(createConfig().input.runnerGroupId).toBe(1);
  });

  it('should read a custom runner group id', () => {
    expect(createConfig({ 'runner-group-id': '42' }).input.runnerGroupId).toBe(42);
  });

  it('should throw when useJit and runAsService are both true', () => {
    expect(() => createConfig({ 'use-jit': 'true', 'run-runner-as-service': 'true' })).toThrow(
      "The 'use-jit' and 'run-runner-as-service' inputs are incompatible"
    );
  });
});

describe('Config - runner debug input', () => {
  it('should read runnerDebug as false by default', () => {
    expect(createConfig().input.runnerDebug).toBe(false);
  });

  it('should read runnerDebug as true when set', () => {
    expect(createConfig({ 'runner-debug': 'true' }).input.runnerDebug).toBe(true);
  });
});
