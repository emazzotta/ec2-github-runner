const core = require('@actions/core');

const defaultInputs = {
  'mode': 'start',
  'github-token': 'test-token',
  'ec2-image-id': 'ami-123',
  'ec2-instance-type': 't3.micro',
  'subnet-id': 'subnet-123',
  'security-group-id': 'sg-123',
  'label': '',
  'ec2-instance-ids': '',
  'ec2-instance-count': '1',
  'instance-initiated-shutdown-behavior': '',
  'iam-role-name': '',
  'market-type': '',
  'pre-runner-script': '',
  'runner-home-dir': '',
  'startup-quiet-period-seconds': '',
  'startup-retry-interval-seconds': '',
  'startup-timeout-minutes': '5',
  'run-runner-as-service': 'false',
  'run-runner-as-user': '',
  'ec2-volume-size': '',
  'ec2-device-name': '/dev/sda1',
  'ec2-volume-type': '',
  'block-device-mappings': '[]',
  'availability-zones-config': '',
  'metadata-options': '{}',
  'packages': '[]',
  'aws-resource-tags': '[]',
  'use-jit': 'false',
  'runner-group-id': '1',
  'runner-debug': 'false',
};

function setupInputs(overrides = {}) {
  const inputs = { ...defaultInputs, ...overrides };
  core.getInput.mockImplementation((name) => inputs[name] || '');
  process.env.AWS_REGION = 'us-east-1';
}

function createConfig(overrides = {}) {
  setupInputs(overrides);
  const { Config } = require('../../config');
  return new Config();
}

function loadFresh(modulePath, overrides) {
  setupInputs(overrides);

  let loaded;
  jest.isolateModules(() => {
    loaded = require(modulePath);
  });
  return loaded;
}

const loadAws = (overrides = {}) => loadFresh('../../aws', overrides);
const loadGh = (overrides = {}) => loadFresh('../../gh', overrides);

module.exports = { defaultInputs, setupInputs, createConfig, loadAws, loadGh };
