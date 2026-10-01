# Local data contract

Version 1 uses one localStorage key, `thara_operations_v1`. A single atomic write stores validated current records and the previous known-good snapshot. Save failures are reported; the UI must not pretend an unsaved change succeeded. Each save increments a revision. Browser writers serialize using Web Locks; revision checks reject stale tabs. Use a modern browser supporting Web Locks for editing.

The schema stores farm settings, inventory items, append-only stock movements, equipment, append-only service records and dated activities. Dates are calendar strings, not midnight timestamps. The configured IANA time zone determines today's date. Currency is a preference only: this release has no accounting ledger or exchange-rate calculations. Meter and quantity arithmetic is deterministic. There are no model downloads or farm-data uploads.

Backups contain the complete current version-1 operations schema. Imports validate all records, fields, dates, quantities, IDs and references before an explicit replacement confirmation; unknown versions are rejected rather than guessed. No migrations from unknown earlier schemas are automatic. Importing replaces the current operations workspace, not unrelated browser storage. The former current snapshot remains available for undo.

Corruption blocks ordinary writes. Export raw records for preservation before attempting recovery. If the previous snapshot is valid, explicitly restore it. Otherwise import a separately saved valid backup through the recovery path; rejected raw data is retained as recovery evidence. If both browser data and external backups are lost, the app cannot reconstruct the records.

Storage is tied to exact scheme, hostname, port and browser profile. Changing host or port creates a different store; export from the old origin before moving. LocalStorage can be blocked, full, cleared or evicted. Requesting persistent browser storage may reduce automatic eviction but does not prevent user deletion or device loss. Backup files contain private farm records: store and share them accordingly.

Offline capability requires a first successful production load and service-worker installation. Updates wait for older app tabs to close, keeping the active shell consistent. No background synchronization takes place. Reopen online periodically to receive self-hosted app updates, then close all app tabs and reopen to activate the new shell.
