import * as core from '@actions/core';
import * as github from '@actions/github';

type DeploymentState =
  | 'error'
  | 'failure'
  | 'inactive'
  | 'in_progress'
  | 'queued'
  | 'pending'
  | 'success';

const VALID_STATES: DeploymentState[] = [
  'error', 'failure', 'inactive', 'in_progress', 'queued', 'pending', 'success',
];

interface StatusFile {
  service: string;
  environment: string;
  sha: string;
  ref: string;
  version: string;
  status: string;
  timestamp: string;
  description?: string;
  environment_url?: string;
  repo: string;
  owner: string;
}

async function writeStatusFile(
  token: string,
  dashboardRepo: string,
  dashboardBranch: string,
  statusData: StatusFile,
): Promise<void> {
  const octokit = github.getOctokit(token);
  const [owner, repo] = dashboardRepo.split('/');
  const filePath = `status/${statusData.service}/${statusData.environment}.json`;
  const content = JSON.stringify(statusData, null, 2);
  const contentBase64 = Buffer.from(content).toString('base64');

  // Try to get existing file SHA (needed for updates)
  let existingSha: string | undefined;
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: filePath,
      ref: dashboardBranch,
    });
    if (!Array.isArray(data) && data.type === 'file') {
      existingSha = data.sha;
    }
  } catch (err: unknown) {
    const error = err as { status?: number };
    if (error.status !== 404) throw err;
    // File doesn't exist yet — will create
  }

  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: filePath,
    message: `deploy: ${statusData.service} → ${statusData.environment} (${statusData.version})`,
    content: contentBase64,
    branch: dashboardBranch,
    sha: existingSha,
  });

  core.info(`Status file written to ${dashboardRepo}/${filePath} on ${dashboardBranch}`);
}

async function run(): Promise<void> {
  try {
    const token = core.getInput('token', { required: true });
    const environment = core.getInput('environment', { required: true });
    const status = (core.getInput('status') || 'success') as string;
    const environmentUrl = core.getInput('environment-url') || undefined;
    const description = core.getInput('description') || undefined;

    const { context } = github;
    const service = core.getInput('service') || context.repo.repo;
    const overrideSha = core.getInput('sha') || '';
    const effectiveSha = overrideSha || context.sha;
    const version = core.getInput('version') || effectiveSha.substring(0, 7);

    const dashboardRepo = core.getInput('dashboard-repo') || '';
    const dashboardBranch = core.getInput('dashboard-branch') || 'gh-pages';
    const dashboardToken = core.getInput('dashboard-token') || token;

    if (!VALID_STATES.includes(status as DeploymentState)) {
      core.setFailed(
        `Invalid status "${status}". Must be one of: ${VALID_STATES.join(', ')}`,
      );
      return;
    }

    const octokit = github.getOctokit(token);
    const payload = JSON.stringify({ service, version });

    core.info(`Creating deployment for ${service}@${version} to ${environment}`);

    const deploymentResponse = await octokit.rest.repos.createDeployment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      ref: effectiveSha,
      environment,
      payload,
      auto_merge: false,
      required_contexts: [],
      description: description || `Deploy ${service}@${version} to ${environment}`,
      transient_environment: false,
      production_environment: environment === 'prod' || environment === 'production',
    });

    if (deploymentResponse.status === 201) {
      const deploymentId = deploymentResponse.data.id;
      core.info(`Deployment created with ID: ${deploymentId}`);

      await octokit.rest.repos.createDeploymentStatus({
        owner: context.repo.owner,
        repo: context.repo.repo,
        deployment_id: deploymentId,
        state: status as DeploymentState,
        environment_url: environmentUrl,
        description: description || `${service}@${version} deployed to ${environment}`,
        auto_inactive: true,
      });

      core.info(`Deployment status set to: ${status}`);

      core.setOutput('deployment-id', deploymentId.toString());
      core.setOutput('service', service);
      core.setOutput('version', version);

      // Write status file if dashboard-repo is configured
      if (dashboardRepo) {
        try {
          await writeStatusFile(dashboardToken, dashboardRepo, dashboardBranch, {
            service,
            environment,
            sha: effectiveSha,
            ref: context.ref,
            version,
            status,
            timestamp: new Date().toISOString(),
            description: description || `${service}@${version} deployed to ${environment}`,
            environment_url: environmentUrl,
            repo: context.repo.repo,
            owner: context.repo.owner,
          });
        } catch (err) {
          // Don't fail the whole action if status file write fails
          const msg = err instanceof Error ? err.message : 'Unknown error';
          core.warning(`Failed to write status file: ${msg}`);
        }
      }
    } else {
      core.warning(
        `Unexpected deployment API response status: ${deploymentResponse.status}. ` +
        `The deployment may have been queued for auto-merge.`,
      );
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(`Action failed: ${error.message}`);
    } else {
      core.setFailed('Action failed with an unknown error');
    }
  }
}

run();
