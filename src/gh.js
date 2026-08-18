const core = require('@actions/core');
const github = require('@actions/github');
const _ = require('lodash');
const config = require('./config');

// use the unique label to find the runners
// as we don't have the runners' ids, it's not possible to get them in any other way
async function getRunners(label) {
  const octokit = github.getOctokit(config.input.githubToken);

  try {
    const runners = await octokit.paginate('GET /repos/{owner}/{repo}/actions/runners', config.githubContext);
    return _.filter(runners, { labels: [{ name: label }] });
  } catch (error) {
    return [];
  }
}

// get GitHub Registration Token for registering a self-hosted runner
async function getRegistrationToken() {
  const octokit = github.getOctokit(config.input.githubToken);

  try {
    const response = await octokit.request('POST /repos/{owner}/{repo}/actions/runners/registration-token', config.githubContext);
    core.info('GitHub Registration Token is received');
    return response.data.token;
  } catch (error) {
    core.error('GitHub Registration Token receiving error');
    throw error;
  }
}

// generate a JIT (Just-In-Time) runner configuration via the GitHub API
async function getJitRunnerConfig(label) {
  const octokit = github.getOctokit(config.input.githubToken);

  try {
    const response = await octokit.request(
      'POST /repos/{owner}/{repo}/actions/runners/generate-jitconfig',
      {
        ...config.githubContext,
        name: `ec2-${label}`,
        runner_group_id: config.input.runnerGroupId,
        labels: [label],
        work_folder: '_work',
      }
    );

    core.info('GitHub JIT runner configuration is received');
    return {
      runnerId: response.data.runner.id,
      encodedJitConfig: response.data.encoded_jit_config,
    };
  } catch (error) {
    core.error('GitHub JIT runner configuration generation error');
    throw error;
  }
}

async function removeRunners() {
  const runners = await getRunners(config.input.label);
  const octokit = github.getOctokit(config.input.githubToken);

  // skip the runner removal process if no runner is found
  if (runners.length === 0) {
    core.info(`GitHub self-hosted runner with label ${config.input.label} is not found, so the removal is skipped`);
    return;
  }

  // a failure to remove one runner must not strand the remaining ones
  let firstError = null;
  for (const runner of runners) {
    try {
      await octokit.request('DELETE /repos/{owner}/{repo}/actions/runners/{runner_id}', { ...config.githubContext, runner_id: runner.id });
      core.info(`GitHub self-hosted runner ${runner.name} is removed`);
    } catch (error) {
      core.error(`GitHub self-hosted runner ${runner.name} removal error`);
      firstError = firstError || error;
    }
  }

  if (firstError) {
    throw firstError;
  }
}

async function waitForRunnersRegistered(label, expectedCount, onPollCallback) {
  const timeoutMinutes = parseInt(config.input.startupTimeoutMinutes) || 5;
  const retryIntervalSeconds = parseInt(config.input.startupRetryIntervalSeconds) || 10;
  const quietPeriodSeconds = parseInt(config.input.startupQuietPeriodSeconds) || 30;

  core.info(`Waiting ${quietPeriodSeconds}s for the AWS EC2 instance to be registered in GitHub as a new self-hosted runner`);
  await new Promise((r) => setTimeout(r, quietPeriodSeconds * 1000));
  core.info(`Checking every ${retryIntervalSeconds}s if the ${expectedCount} GitHub self-hosted runner(s) are registered`);
  core.info(`The maximum waiting time is ${timeoutMinutes} minutes`);

  const startTime = Date.now();
  const timeoutMs = timeoutMinutes * 60 * 1000;

  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      const elapsedMs = Date.now() - startTime;
      const elapsedSec = Math.round(elapsedMs / 1000);
      const onlineRunners = (await getRunners(label)).filter((runner) => runner.status === 'online');

      if (onlineRunners.length >= expectedCount) {
        core.info(`GitHub self-hosted runner(s) ${onlineRunners.map((runner) => runner.name).join(', ')} are registered and ready to use`);
        clearInterval(interval);
        resolve();
      } else if (elapsedMs >= timeoutMs) {
        core.error('GitHub self-hosted runner registration error');
        // Fetch console output one last time before failing
        if (onPollCallback) {
          try { await onPollCallback(); } catch (e) { core.warning(`Poll callback error: ${e.message}`); }
        }
        clearInterval(interval);
        reject(
          `A timeout of ${timeoutMinutes} minutes is exceeded. Only ${onlineRunners.length} of ${expectedCount} AWS EC2 instances registered themselves in GitHub as new self-hosted runners.`,
        );
      } else {
        core.info(`Checking... (${elapsedSec}s elapsed, ${onlineRunners.length}/${expectedCount} online)`);
        if (onPollCallback) {
          try { await onPollCallback(); } catch (e) { core.warning(`Poll callback error: ${e.message}`); }
        }
      }
    }, retryIntervalSeconds * 1000);
  });
}

module.exports = {
  getRegistrationToken,
  getJitRunnerConfig,
  removeRunners,
  waitForRunnersRegistered,
};
