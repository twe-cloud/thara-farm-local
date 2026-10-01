# Contributing

Thara Farm local edition is licensed under Apache-2.0. Intentionally submitted contributions are covered by the license contribution terms unless explicitly stated otherwise. Retain third-party notices and identify material changes.

Keep records local by default. Add no telemetry, account requirement, paid dependency or silent model download. Avoid introducing private records, deployment configuration, credentials or copied assets. Tests and screenshots must use clearly synthetic data.

Changes to persisted data require versioned validation, explicit migration design, rollback/recovery behavior and export/import round-trip tests. Never rewrite ledger history silently. Test quota failures, corrupt input, unsupported versions, stale tabs and offline restart, plus keyboard and narrow-screen use.

Describe user-visible changes, tests performed and remaining limits in pull requests. Security issues should be reported privately under SECURITY.md, without farm data or credentials in a public issue.
