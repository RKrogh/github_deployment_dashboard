# github-deployment-dashboard

Comes with a nifty list of your reporting services, and what environment has what latest commit on it.

![image](https://github.com/user-attachments/assets/d9b4573c-a0ff-4979-8630-60fc91b3cb8c)

Also, each service, if using a PAT for your repo as described below, could give you details on each service, with useful links:

<img width="953" height="654" alt="image" src="https://github.com/user-attachments/assets/fb66d8fa-2d6f-4c39-b671-93f4d35c12ea" />

A cross-repository deployment dashboard for GitHub. See which commit of each service is deployed to which environment, with drift detection.

Two components:

1. **Tracking Action** — A reusable GitHub Action that records deployments via the GitHub Deployments API
2. **Dashboard** — A single HTML file that visualizes the deployment matrix across services and environments

## Two Modes

1. [Static Mode](#quick-start-static-mode)
2. [API Mode](#quick-start-api-mode)

|                  | Static mode (recommended for teams)                     | API mode (simple setups)              |
| ---------------- | ------------------------------------------------------- | ------------------------------------- |
| How it works     | Deploy action pushes status files; dashboard reads them | Dashboard queries GitHub API directly |
| Token in browser | Not needed                                              | PAT required                          |
| Rate limits      | None (static file reads)                                | ~2 API calls per cell per refresh     |
| Real-time        | Updates on every deploy                                 | Polls on interval                     |
| Best for         | Mono-repos, many services, teams                        | Few services, personal use            |

## Quick Start (Static Mode)

### 1. Create a dashboard repo

This dashboard tool supports both monorepos and multi-repos. To make everything easier, and to be able to host a dedicated url for it within Github using Pages, use a new repository:

Create a dedicated repo (e.g., `your-org/deployment-dashboard`) to act as the central hub. This repo holds the dashboard UI and receives status files from all your service deployments. Keeping it separate means your source repos stay clean and the dashboard is accessible to anyone in the org without needing a token.

Create a `gh-pages` branch (or whatever floats your boat, just remember to target it when copying the lines below) with two files:

- `index.html` — simply copy it from this repo's [`dashboard/`](./dashboard) directory
- `.deployment-dashboard.yml` — your config (see [Configuration](#configuration))

### 2. Add the tracking action to each service's deploy workflow

```yaml
- uses: RKrogh/github_deployment_dashboard/action@main
  with:
    environment: staging
    service: my-service # required for mono-repos
    dashboard-repo: your-org/deployment-dashboard
    dashboard-branch: gh-pages # default
    dashboard-token: ${{ secrets.DASHBOARD_TOKEN }}
```

On every deploy, the action writes a status file (`status/{service}/{env}.json`) to the dashboard repo. Each service/environment combination gets its own file, so concurrent deploys never conflict.

### 3. Enable GitHub Pages

In the dashboard repo settings, set GitHub Pages source to `/(root)` on the `gh-pages` branch. The dashboard is now live at `https://your-org.github.io/deployment-dashboard` — no token needed!

## Quick Start (API Mode)

### 1. Add the tracking action (without dashboard-repo)

```yaml
- uses: RKrogh/github_deployment_dashboard/action@main
  with:
    environment: staging
```

### 2. Open the dashboard

Open `dashboard/index.html`, switch to "GitHub API" mode, enter your PAT, and paste your config.

## Action Reference

### Inputs

| Input              | Required | Default               | Description                                                                                                  |
| ------------------ | -------- | --------------------- | ------------------------------------------------------------------------------------------------------------ |
| `environment`      | Yes      | —                     | Target environment name (e.g., `dev`, `staging`, `prod`)                                                     |
| `service`          | No       | Repository name       | Service name. Set this for mono-repos to distinguish services.                                               |
| `version`          | No       | Short SHA             | Version string (semver tag, build number, etc.)                                                              |
| `status`           | No       | `success`             | Deployment status: `success`, `failure`, `error`, `inactive`, `in_progress`, `queued`, `pending`             |
| `environment-url`  | No       | —                     | URL to the deployed environment                                                                              |
| `description`      | No       | Auto-generated        | Free-form description                                                                                        |
| `token`            | Yes      | `${{ github.token }}` | GitHub token. The default token works for the current repo.                                                  |
| `dashboard-repo`   | No       | —                     | Repository to write status files to (e.g., `org/deployment-dashboard`). Enables static mode.                     |
| `dashboard-branch` | No       | `gh-pages`            | Branch to write status files to.                                                                             |
| `dashboard-token`  | No       | Same as `token`       | Token with write access to the dashboard repo. Set this if the dashboard repo differs from the current repo. |

### Outputs

| Output          | Description                         |
| --------------- | ----------------------------------- |
| `deployment-id` | ID of the created GitHub deployment |
| `service`       | Resolved service name               |
| `version`       | Resolved version string             |

### Token Permissions

```yaml
permissions:
  deployments: write # always required
  contents: write # needed if dashboard-repo is the same repo
```

If `dashboard-repo` is a **different** repo, create a PAT or GitHub App token with `contents:write` on that repo and store it as `DASHBOARD_TOKEN` secret.

## Dashboard Setup

The dashboard is a single `index.html` file with no build step. It supports two data modes:

- **Static mode** — Place it in the dashboard repo on GitHub Pages alongside the status files. The dashboard auto-detects `.deployment-dashboard.yml` next to it. No token needed — the browser reads static JSON files directly.
- **API mode** — Open locally or host anywhere. The dashboard queries the GitHub Deployments API directly, so a GitHub PAT is required in the browser.

### Configuration

```yaml
org: your-org

environments:
  - dev
  - staging
  - prod

services:
  - repo: order-service
  - repo: gateway-api
    display_name: API Gateway
  - repo: backend-monorepo
    services:
      - name: auth-module
      - name: billing-module
```

## Mono-Repo Support

For mono-repos where multiple services are deployed from a single repository:

1. **In your workflow**, set the `service` input to differentiate deployments:

   ```yaml
   - uses: RKrogh/github_deployment_dashboard/action@main
     with:
       environment: staging
       service: auth-module
       dashboard-repo: your-org/deployment-dashboard
   ```

2. **In your config**, list sub-services under the repo:

   ```yaml
   - repo: backend-monorepo
     services:
       - name: auth-module
       - name: billing-module
   ```

The action stores the service name in both the deployment payload and the status file path (`status/auth-module/staging.json`).

## Drift Detection

The dashboard detects "drift" when the commit SHA deployed to your first environment (e.g., `dev`) differs from the last environment (e.g., `prod`). Drifted services are highlighted with an orange indicator showing the number of commits ahead (in API mode).

## Status File Format

Each status file written by the action (`status/{service}/{env}.json`):

```json
{
  "service": "auth-module",
  "environment": "staging",
  "sha": "abc1234def5678...",
  "ref": "refs/heads/main",
  "version": "v1.2.3",
  "status": "success",
  "timestamp": "2026-02-13T12:00:00.000Z",
  "description": "auth-module@v1.2.3 deployed to staging",
  "environment_url": "https://staging.example.com",
  "repo": "backend-monorepo",
  "owner": "your-org"
}
```

## Examples

See the [`examples/`](./examples) directory:

- [`multi-repo.yml`](./examples/multi-repo.yml) — Standard single-service workflow
- [`mono-repo.yml`](./examples/mono-repo.yml) — Mono-repo with path-based change detection
- [`.deployment-dashboard.yml`](./examples/.deployment-dashboard.yml) — Sample config

## Contributing

### Building the action

```bash
cd action
npm install
npm run build       # Compiles to dist/index.js
npm run typecheck   # Type-check only (no emit)
```

The `dist/` directory is committed to the repo (required by GitHub Actions).

### Dashboard

The dashboard is a single HTML file — edit `dashboard/index.html` directly. No build step needed.

## License

MIT
