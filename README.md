# Bus Bunching Lab

An interactive browser simulation for exploring why buses bunch and what dispatch interventions cost passengers. A delayed bus encounters more waiting riders, takes longer to board them, and falls further behind. The following bus finds smaller queues and catches up.

## Credits

Project author and direction: [MentalNomad](https://github.com/MentalNomad). Coding and testing were performed by GPT-6.1 Sol and GPT-6 Astra under the author's direction.

## Explore and teach

- Start with the balanced fixed-arrival route and five-second stopping/starting delays; watch buses, queues, and spacing, then adjust the setup.
- Compare current-model lessons covering disruptions, random demand, coordinated holds, drop-off-only recovery, announced skips, bounded boarding and safeguards. Counterexamples show why smoother spacing can still cost passengers more.
- Hold buses, slow a segment, skip stops, or restrict boarding while preserving accepted drop-offs; rewind deterministically and branch an experiment with a new intervention.
- Configure automatic responses to the gaps both ahead of and behind each bus. Announced patterns can start after a lead-in, serve every Kth stop, and finish after a span, recovery, cancellation, or a time cap.
- Open a paused copy of the current state, export observations as CSV, and import or export reusable scenario JSON.

The [educator scenario guide](dist/scenario-guide.html) explains the format, units, recovery rules, and validation limits, with examples to copy or download. Scenario exports restart at time zero; current-state copies preserve passengers and history. Custom scenarios are stored in the current browser, so export them for backup and sharing.

The [lesson review](SCENARIOS.md) records the refreshed presets and complete matched-cohort comparisons. Run `npm run audit:scenarios` to reproduce it. Results apply to each lesson's setup and seed; recovery is not guaranteed after editing them. Export text to preserve a lesson recipe, since built-in URLs open its current definition.

Charts show dwell, queue wait, and total system time. Hover or tap to inspect an actual observation and the trailing average at that time; arrow keys also work on a focused graph. Intermediate playback speeds include 240×, 480× and 960× before Max. System time includes initial queue wait, boarding, riding, holds, and final debarking. Summary means include completed passengers only; current queue waits, repeated and unique passenger pass-overs, and passenger time accrued across completed and unfinished trips expose costs to people left waiting. Accrued time is displayed in passenger-minutes; CSV uses seconds and a separate count column. Whole-stop chart averages publish at departure and include complete passenger groups until at least the chosen window size is covered. Each-passenger mode uses exactly the last N observations.

Every scenario uses one strict JSON language and the same simulation model: deterministic circular neighbors, passenger-cost control, destination coverage safeguards and per-visit boarding allowances. Restrictions always honor accepted drop-offs. The educator guide documents every field and rule.

The **Complete passenger comparisons** section supports an inclusive finite arrival cutoff, bounded drain, matching full passenger birth records, and JSON/CSV passenger exports. Complete-cohort mean, p95 and maximum remain unavailable while any cohort passenger is unfinished. The cohort includes riders already waiting or aboard just before its boundary, plus later arrivals through the cutoff. Controls must start at or after that boundary. Keep an observation, load another policy with identical demand and boundaries, and compare after both drain.

Optional stopping/starting delays (zero at skipped stops), fixed stop overhead, finite capacity and continuous no-overtaking are independent model choices; defaults remain zero overhead, unlimited seats and overtaking. The temporal controller conservatively keeps normal service when overtaking is disabled because joint road-and-door prediction is not implemented; manual controls still operate. Example values are illustrative, not empirically calibrated. The [design note](DESIGN.md) defines event order, prediction limitations, controller budgets, safeguards and compatibility. A separate local research package under `../research/controller-repair-2026-10-15/` contains frozen-source paired comparisons and independent review; it is not part of the static website.

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

The event-driven model starts with empty queues and evenly spaced buses. Defaults use unlimited capacity, overtaking and no fixed stop overhead; scenarios can change these independently. Service debarks riders before boarding. All service plans protect accepted drop-offs. Seeded randomness supports repeatable comparisons. Recovery rules illustrate tradeoffs rather than optimized dispatch. Runs pause at seven simulated days, 250,000 arrivals, or 250,000 served stops; events sharing the last timestamp finish together.

- `dist/`: editable static site, simulation, charts, scenario tools, and educator guide.
- `tests/`: Node’s built-in test runner covers model, replay, chart, and scenario behavior.
- `.github/workflows/pages.yml`: verification and Pages deployment.
