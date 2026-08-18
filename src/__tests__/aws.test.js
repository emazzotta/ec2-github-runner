const mockSend = jest.fn();

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

jest.mock('@aws-sdk/client-ec2', () => ({
  EC2Client: jest.fn(() => ({ send: mockSend })),
  RunInstancesCommand: jest.fn((params) => ({ params })),
  TerminateInstancesCommand: jest.fn((params) => ({ params })),
  GetConsoleOutputCommand: jest.fn((params) => ({ params })),
  waitUntilInstanceRunning: jest.fn(),
}));

const { RunInstancesCommand, TerminateInstancesCommand } = require('@aws-sdk/client-ec2');
const { loadAws } = require('./support/inputs');

function runInstancesParams() {
  return RunInstancesCommand.mock.calls[0][0];
}

function instancesReply(...ids) {
  return { Instances: ids.map((InstanceId) => ({ InstanceId })) };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('aws.js - launching instances', () => {
  it('should request as many instances as the instance count', async () => {
    mockSend.mockResolvedValue(instancesReply('i-aaa', 'i-bbb', 'i-ccc'));
    const aws = loadAws({ 'ec2-instance-count': '3' });

    await aws.startEc2Instances('testlabel', 'regtoken123', null);

    expect(runInstancesParams()).toMatchObject({ MinCount: 3, MaxCount: 3 });
  });

  it('should return every launched instance id with its region', async () => {
    mockSend.mockResolvedValue(instancesReply('i-aaa', 'i-bbb'));
    const aws = loadAws({ 'ec2-instance-count': '2' });

    const result = await aws.startEc2Instances('testlabel', 'regtoken123', null);

    expect(result).toEqual({ ec2InstanceIds: ['i-aaa', 'i-bbb'], region: 'us-east-1' });
  });

  it('should default to launching a single instance', async () => {
    mockSend.mockResolvedValue(instancesReply('i-aaa'));
    const aws = loadAws();

    const result = await aws.startEc2Instances('testlabel', 'regtoken123', null);

    expect(runInstancesParams()).toMatchObject({ MinCount: 1, MaxCount: 1 });
    expect(result.ec2InstanceIds).toEqual(['i-aaa']);
  });

  it('should pass the configured shutdown behaviour', async () => {
    mockSend.mockResolvedValue(instancesReply('i-aaa'));
    const aws = loadAws({ 'instance-initiated-shutdown-behavior': 'terminate' });

    await aws.startEc2Instances('testlabel', 'regtoken123', null);

    expect(runInstancesParams()).toMatchObject({ InstanceInitiatedShutdownBehavior: 'terminate' });
  });

  it('should fall back to the next availability zone when the first fails', async () => {
    mockSend
      .mockRejectedValueOnce(new Error('InsufficientInstanceCapacity'))
      .mockResolvedValueOnce(instancesReply('i-bbb'));
    const aws = loadAws({
      'availability-zones-config':
        '[{"imageId":"ami-1","subnetId":"subnet-1","securityGroupId":"sg-1","region":"eu-central-1"},' +
        '{"imageId":"ami-2","subnetId":"subnet-2","securityGroupId":"sg-2","region":"eu-west-1"}]',
    });

    const result = await aws.startEc2Instances('testlabel', 'regtoken123', null);

    expect(result).toEqual({ ec2InstanceIds: ['i-bbb'], region: 'eu-west-1' });
  });

  it('should throw when every availability zone fails', async () => {
    mockSend.mockRejectedValue(new Error('InsufficientInstanceCapacity'));
    const aws = loadAws();

    await expect(aws.startEc2Instances('testlabel', 'regtoken123', null)).rejects.toThrow(
      'Failed to start EC2 instances in any availability zone'
    );
  });
});

describe('aws.js - terminating instances', () => {
  it('should terminate every instance id in a single call', async () => {
    mockSend.mockResolvedValue({});
    const aws = loadAws({ 'mode': 'stop', 'label': 'abc12', 'ec2-instance-ids': '["i-aaa","i-bbb"]' });

    await aws.terminateEc2Instances();

    expect(TerminateInstancesCommand).toHaveBeenCalledTimes(1);
    expect(TerminateInstancesCommand.mock.calls[0][0]).toEqual({ InstanceIds: ['i-aaa', 'i-bbb'] });
  });

  it('should rethrow when termination fails', async () => {
    mockSend.mockRejectedValue(new Error('InvalidInstanceID.NotFound'));
    const aws = loadAws({ 'mode': 'stop', 'label': 'abc12', 'ec2-instance-ids': '["i-aaa"]' });

    await expect(aws.terminateEc2Instances()).rejects.toThrow('InvalidInstanceID.NotFound');
  });
});

describe('aws.js - user-data generation', () => {
  it('should omit config.sh from JIT user-data', () => {
    const aws = loadAws({ 'use-jit': 'true' });
    const userData = aws._buildUserDataScriptForTest(null, 'testlabel', 'encodedconfig123');
    expect(userData).not.toContain('config.sh');
    expect(userData).toContain('--jitconfig encodedconfig123');
  });

  it('should skip the runner download when a runner home dir is given', () => {
    const aws = loadAws({ 'use-jit': 'true', 'runner-home-dir': '/home/runner/actions-runner' });
    const userData = aws._buildUserDataScriptForTest(null, 'testlabel', 'encodedconfig123');
    expect(userData).toContain('/home/runner/actions-runner');
    expect(userData).not.toContain('mkdir actions-runner');
  });

  it('should start the JIT runner through runuser when a run-as user is given', () => {
    const aws = loadAws({ 'use-jit': 'true', 'run-runner-as-user': 'ubuntu' });
    const userData = aws._buildUserDataScriptForTest(null, 'testlabel', 'encodedconfig123');
    expect(userData).toContain('runuser -u ubuntu -- ./run.sh --jitconfig encodedconfig123');
  });

  it('should register through config.sh when JIT is disabled', () => {
    const aws = loadAws();
    const userData = aws._buildUserDataScriptForTest('regtoken123', 'testlabel', null);
    expect(userData).toContain('config.sh');
    expect(userData).toContain('--token regtoken123');
    expect(userData).not.toContain('--jitconfig');
  });

  it('should install the runner as a service when asked', () => {
    const aws = loadAws({ 'run-runner-as-service': 'true' });
    const userData = aws._buildUserDataScriptForTest('regtoken123', 'testlabel', null);
    expect(userData).toContain('svc.sh install');
    expect(userData).toContain('svc.sh start');
  });

  it('should never install a service for a JIT runner', () => {
    const aws = loadAws({ 'use-jit': 'true' });
    const userData = aws._buildUserDataScriptForTest(null, 'testlabel', 'encodedconfig123');
    expect(userData).not.toContain('svc.sh');
  });

  it('should emit cloud-config user-data', () => {
    const aws = loadAws();
    const userData = aws._buildUserDataScriptForTest('regtoken123', 'testlabel', null);
    expect(userData).toMatch(/^#cloud-config\n/);
    expect(userData).toContain('write_files:');
    expect(userData).toContain('runcmd:');
  });

  it('should write the setup script to /opt and run it with nohup', () => {
    const aws = loadAws();
    const userData = aws._buildUserDataScriptForTest('regtoken123', 'testlabel', null);
    expect(userData).toContain('path: /opt/runner-setup.sh');
    expect(userData).toContain('permissions: "0755"');
    expect(userData).toContain('nohup /opt/runner-setup.sh &');
  });

  it('should remove stale runner config from a prebaked AMI', () => {
    const aws = loadAws({ 'runner-home-dir': '/home/runner/actions-runner' });
    const userData = aws._buildUserDataScriptForTest('regtoken123', 'testlabel', null);
    expect(userData).toContain('rm -f .runner .credentials .credentials_rsaparams');
  });

  it('should chown tolerantly and run through runuser when a run-as user is given', () => {
    const aws = loadAws({ 'run-runner-as-user': 'ec2-user' });
    const userData = aws._buildUserDataScriptForTest('regtoken123', 'testlabel', null);
    expect(userData).toContain('chown -R ec2-user . 2>&1 || true');
    expect(userData).toContain('runuser -u ec2-user -- ./run.sh');
  });

  it('should install the requested packages', () => {
    const aws = loadAws({ 'packages': '["git", "docker.io"]' });
    const userData = aws._buildUserDataScriptForTest('regtoken123', 'testlabel', null);
    expect(userData).toContain('packages:');
    expect(userData).toContain('  - git');
    expect(userData).toContain('  - docker.io');
  });

  it('should include the debug echoes only when runner debug is on', () => {
    const debugUserData = loadAws({ 'runner-debug': 'true' })._buildUserDataScriptForTest('regtoken123', 'testlabel', null);
    expect(debugUserData).toContain('echo "[RUNNER] Setup script started at');

    const quietUserData = loadAws({ 'runner-debug': 'false' })._buildUserDataScriptForTest('regtoken123', 'testlabel', null);
    expect(quietUserData).not.toContain('[RUNNER] Setup script started');
  });
});
