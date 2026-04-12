# GitHub Release Workflow — Design Spec

**Date:** 2026-04-12
**Scope:** Automated build and release via GitHub Actions

---

## Problem

No CI/CD exists. Building and distributing releases is manual.

---

## Trigger

Push a git tag matching `v*` (e.g., `v1.0.0`, `v1.2.3-beta`).

```bash
git tag v1.0.0
git push origin v1.0.0
```

---

## Workflow

**Runner:** `windows-latest` (x86_64 MSVC)

**Steps:**

1. Checkout code at the tag
2. Install Rust stable toolchain
3. Run `cargo test` — fail the workflow if any test fails
4. Run `cargo build --release`
5. Create a GitHub Release using the tag name as title
6. Upload individual files as release assets (no zip):
   - `target/release/claude-proxy.exe`
   - `model-config.sample.json`
   - `README.md`

---

## Release Naming

- **Release title:** Tag name (e.g., `v1.0.0`)
- **Asset names:** Files uploaded with their original names:
  - `claude-proxy.exe`
  - `model-config.sample.json`
  - `README.md`

---

## Versioning

The git tag IS the version. No Cargo.toml version sync — avoids commits-from-CI complexity.

---

## Files

| File | Action |
|------|--------|
| `.github/workflows/release.yml` | Create — the workflow |

---

## Verification

1. Push a tag — workflow triggers
2. Tests run and pass
3. Release appears on GitHub with 3 attached files
4. `claude-proxy.exe` downloads and runs
