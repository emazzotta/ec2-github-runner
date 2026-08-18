const aws = require('./aws');
const gh = require('./gh');
const config = require('./config');
const core = require('@actions/core');

function setOutput(label, ec2InstanceIds, region) {
  core.setOutput('label', label);
  core.setOutput('ec2-instance-ids', ec2InstanceIds);
  core.setOutput('region', region);
}

async function start() {
  const label = config.input.label ? config.input.label : config.generateUniqueLabel();

  let githubRegistrationToken = null;
  let encodedJitConfig = null;

  if (config.input.useJit) {
    const jitConfig = await gh.getJitRunnerConfig(label);
    encodedJitConfig = jitConfig.encodedJitConfig;
    core.info(`JIT runner created with runner ID: ${jitConfig.runnerId}`);
  } else {
    githubRegistrationToken = await gh.getRegistrationToken();
  }

  const { ec2InstanceIds, region } = await aws.startEc2Instances(label, githubRegistrationToken, encodedJitConfig);

  setOutput(label, ec2InstanceIds, region);

  for (const ec2InstanceId of ec2InstanceIds) {
    await aws.waitForInstanceRunning(ec2InstanceId, region);
  }

  let pollCallback = null;

  if (config.input.runnerDebug) {
    // Track how much console output we've already printed to avoid duplicates
    const lastOutputLengths = new Map();

    // Poll callback: fetch EC2 serial console output and log any new content
    pollCallback = async () => {
      for (const ec2InstanceId of ec2InstanceIds) {
        const output = await aws.getInstanceConsoleOutput(ec2InstanceId, region);
        const lastOutputLength = lastOutputLengths.get(ec2InstanceId) || 0;
        if (output && output.length > lastOutputLength) {
          const newOutput = output.substring(lastOutputLength);
          core.info(`--- EC2 Console Output (${ec2InstanceId}) ---\n${newOutput}--- End Console Output ---`);
          lastOutputLengths.set(ec2InstanceId, output.length);
        }
      }
    };
  }

  await gh.waitForRunnersRegistered(label, ec2InstanceIds.length, pollCallback);
}

async function stop() {
  await aws.terminateEc2Instances();

  if (config.input.useJit) {
    core.info('JIT runner auto-deregisters after job completion. Skipping runner removal.');
  } else {
    await gh.removeRunners();
  }
}

(async function () {
  try {
    config.input.mode === 'start' ? await start() : await stop();
  } catch (error) {
    core.error(error);
    core.setFailed(error.message);
  }
})();
