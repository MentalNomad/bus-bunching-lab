# Bus Bunching Lab

An interactive browser simulation for exploring why buses bunch and what dispatch interventions cost passengers. A delayed bus encounters more waiting riders, takes longer to board them, and falls further behind. The following bus finds smaller queues and catches up.

## Credits

Project author and direction: [MentalNomad](https://github.com/MentalNomad). Coding and testing were performed by GPT-6.1 Sol and GPT-6 Astra under the author's direction.

## Explore and teach

- Watch buses, queues, and spacing on a circular route; adjust demand, travel, boarding, and ride lengths.
- Compare six built-in scenarios, from a balanced baseline to random demand and recovery through holds or temporary express service.
- Hold buses, slow a segment, or skip stops; rewind deterministically and branch an experiment with a new intervention.
- Open a paused copy of the current state, export observations as CSV, and import or export reusable scenario JSON.

The [educator scenario guide](dist/scenario-guide.html) explains the format, units, recovery rules, and validation limits, with examples to copy or download. Scenario exports restart at time zero; current-state copies preserve passengers and history. Custom scenarios are stored in the current browser, so export them for backup and sharing.

Charts show dwell, queue wait, and total system time. System time includes initial queue wait, boarding, riding, holds, transfers, and final debarking. Summary means include completed passengers only; unfinished counts stay visible. Whole-stop chart averages publish at departure and include complete passenger groups until at least the chosen window size is covered. Each-passenger mode uses exactly the last N observations.

## Run locally

Use Python 3 to serve the site. Node.js 24 is recommended for development and tests. From the directory containing `package.json`:

```sh
npm ci
npm test
npm run format:check
npm start
```

Open [localhost:8080](http://127.0.0.1:8080). `npm run format` applies consistent formatting. Prettier is a development dependency; the browser app has no JavaScript runtime dependencies or build step.

To run without npm:

```sh
python -m http.server 8080 --bind 127.0.0.1 --directory dist
```

Use `python3` instead of `python` if that is your Python 3 command.

## Publish on GitHub Pages

Review and commit the project files first. If needed, create an empty public repository named `bus-bunching-lab` under `MentalNomad` on GitHub, without adding a README, license, or `.gitignore`. GitHub’s web interface or [GitHub CLI](https://cli.github.com/manual/gh_repo_create) can create it.

From this repository, add the remote if it is not already configured, then upload the committed history:

```sh
git remote add github https://github.com/MentalNomad/bus-bunching-lab.git
git push -u github main
```

The separate `github` remote preserves the existing Sites `origin` remote. Skip adding it if already configured. For later updates, commit changes and run `git push github main`.

In the GitHub repository, select **Settings → Pages → Source → GitHub Actions**. Then open **Actions**, select the Pages workflow, and use **Run workflow** on `main`. The workflow checks tests and formatting on pull requests and pushes to `main`; successful runs deploy only `dist/` from `main`. After deployment, the site address is [mentalnomad.github.io/bus-bunching-lab](https://mentalnomad.github.io/bus-bunching-lab/). See [GitHub’s custom Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Model and source

The event-driven model starts with empty queues and evenly spaced buses. It assumes unlimited capacity, allows overtaking, and models no traffic beyond manual delays. Service debarks riders before boarding; temporary express can require transfers. Seeded randomness supports repeatable comparisons. Recovery rules illustrate tradeoffs rather than optimized dispatch. Runs pause at seven simulated days, 250,000 arrivals, or 250,000 served stops; events sharing the last timestamp finish together.

- `dist/`: editable static site, simulation, charts, scenario tools, and educator guide.
- `tests/`: Node’s built-in test runner covers model, replay, chart, and scenario behavior.
- `.github/workflows/pages.yml`: verification and Pages deployment.
