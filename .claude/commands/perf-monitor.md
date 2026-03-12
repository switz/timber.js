Check timber.js performance benchmarks for regressions.

If $ARGUMENTS is set (a commit SHA), check that specific commit. Otherwise compare the most recent commit against the rolling baseline.

## Regression thresholds

| Metric             | Threshold     | Severity |
| ------------------ | ------------- | -------- |
| Build time         | >20% increase | P2       |
| Bundle size (gzip) | >10% increase | P1       |
| Dev cold start     | >30% increase | P2       |
| Dev peak RSS       | >40% increase | P3       |

## Workflow

1. Run the benchmark suite (if available) or check CI benchmark artifacts
2. Compute rolling baseline: mean of last 5 commits
3. Compare current against baseline
4. `lb list` before filing to avoid duplicates
5. File lb issues for regressions exceeding thresholds
6. Print performance report table

## Rules

- One issue per metric per commit
- Improvements are not actionable (note in report, don't file issues)
- Null metrics are not regressions
- Note if stddev > 50% of the change (may be noise)
