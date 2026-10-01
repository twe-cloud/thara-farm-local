# Release checklist — initial source release

- [x] Empty default records; no sample customers or legacy farm fixtures.
- [x] No login/contact collection, outbound analytics, hosted model or paid infrastructure requirement.
- [x] Validated local persistence, failed-write reporting, append-only movements/services, revision plus raw-state conflict protection, Web Locks for browser writes.
- [x] Full operations export/import, review before replacement, previous-version restore and raw-preserving corruption recovery.
- [x] Legacy archive preserves browser local and surviving session records; automatic conversion intentionally absent.
- [x] 22 persistence regressions pass. Browser synthetic acceptance covers inventory/service/activities, stale tab, corruption recovery, backup cancellation/replacement, offline restart and no outbound requests.
- [x] Production build/typecheck and HTML/manifest service-worker version regressions pass.
- [x] Desktop and mobile render review completed, including narrow 320px viewport. Real-device iOS/Android testing remains outstanding; browser emulation is not device certification.
- [x] Intended source snapshot reviewed independently for private records, secrets, cloud/paid paths and dependency licensing. Old Git history is excluded.
- [x] Runtime third-party notices accompany source and built output; dependency inventory included.
- [x] Owner approved Apache-2.0 with Ni Biashara LLC as copyright holder on 2026-10-01; LICENSE and NOTICE applied to this sanitized edition.
- [x] Separate public repository established under verified owner control; private vulnerability reporting enabled and linked in SECURITY.md.
- [x] Publish only the reviewed clean snapshot; source history starts with this edition.
- [ ] Before replacing any existing deployment, preserve its browser records and review legacy migration plus old sync endpoint retirement. Never turn the historical repository public.

Source repository: https://github.com/twe-cloud/thara-farm-local. No existing deployment has been replaced. Specialized livestock, crop production and financial-accounting workflows are not part of this initial local operations release.
