# Phase 2A provenance — 2026-09-09

Canonical worktree: `D:/DEV/TVG-Flow/.worktrees/p0-editorial-foundation-20260909`

Branch: `fix/p0-editorial-foundation-20260909`

HEAD and live origin/main: `682e804429deb2a70e999f5e6a08ca97a0b64789`.

Remote project: `gyooxmpyxncrezjiljrj`. Read-only catalog inspected before changes.
All AutoPublisher entrypoints match origin/main. Other remote differences:
`create-os-by-function` differs; `ap-debug-user` has no local counterpart. Neither is deployed by this phase.
The R1 worktree adds `1db8c86`, `e72f3e2`, `55c8fd2`; none is included.

Additional read-only verification downloaded the deployed bundles for
`ap-render-engine`, `ap-instagram-publisher`, `ap-content-production`,
`ap-render-recovery`, and `ap-employee-generator` into a separate temporary directory.
Entrypoints, bundled domain helpers, and shared files compared equal to HEAD after
newline normalization. See `p0-remote-function-comparison.json` for paths and SHA256.
No downloaded source replaced implementation files.

Remote migration inventory reconciled by version/name. The four September 7 migrations
already applied remotely are copied from commit `ad1eac205604bdec03bc50882a51c606b6f7868e`
solely to restore migration inventory parity. Remote statement splitting prevents a byte-level
file comparison; these files must NEVER be reapplied to production. No Flow.IA application,
R1 schema, or Instagram POC is incorporated.

- 20260907183019_secure_native_chat_foundation.sql
- 20260907201345_native_chat_ui_operations.sql
- 20260907213000_native_chat_editorial_actions.sql
- 20260907224500_private_chat_image_treatment.sql

Pre-existing root modifications preserved: public/system-version.json and
src/pages/admin/AutoPublisher.jsx. Other worktrees untouched.

Final recheck: root HEAD remains `4057842d390505fced40019f67850ccd96a82aa8`,
5 ahead / 30 behind origin/main. The two pre-existing files retain SHA256
`1BEBBF10A709EC22E328C4C4EAF47C62024C57D8203B38CD4B052DF66015F33C` and
`992F3C1165790477948CFC9B629EDA5BAC9A8001B31176723263307DE9AA6C26`, respectively.
`git ls-remote origin refs/heads/main` again confirmed `682e804429deb2a70e999f5e6a08ca97a0b64789`.

Backup/restoration of the remote project has NOT been demonstrated. Database backups
also do not prove restoration of Storage objects. Production deployment remains blocked
until project-specific evidence and the complete intermediate gate are available.

No production migration, function deployment, frontend deployment, real publication,
Placid render, or paid service invocation is authorized by local test success alone.
