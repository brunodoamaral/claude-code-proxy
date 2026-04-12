# GitHub Release Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a GitHub Actions workflow that builds and releases the Windows binary on tag push.

**Architecture:** Single workflow YAML triggered by `v*` tags. Tests, builds, creates release, uploads 3 assets.

**Tech Stack:** GitHub Actions, Rust toolchain, `actions/checkout`, `dtolnay/rust-toolchain`, `softprops/action-gh-release`

---

## File Structure

| File | Responsibility | Action |
|------|---------------|--------|
| `.github/workflows/release.yml` | CI workflow for building and releasing | Create |

---

### Task 1: Create the release workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create the workflow file**

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  release:
    name: Build and Release
    runs-on: windows-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Install Rust
        uses: dtolnay/rust-toolchain@stable

      - name: Cache cargo
        uses: actions/cache@v4
        with:
          path: |
            ~/.cargo/registry
            ~/.cargo/git
            target
          key: ${{ runner.os }}-cargo-${{ hashFiles('**/Cargo.lock') }}
          restore-keys: |
            ${{ runner.os }}-cargo-

      - name: Run tests
        run: cargo test

      - name: Build release
        run: cargo build --release

      - name: Create Release
        uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
          files: |
            target/release/claude-proxy.exe
            model-config.sample.json
            README.md
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add GitHub Actions release workflow for Windows binary"
```

- [ ] **Step 3: Push**

```bash
git push origin master
```

- [ ] **Step 4: Test by tagging**

```bash
git tag v1.0.0
git push origin v1.0.0
```

Verify: GitHub Actions tab shows the workflow running, then a release appears with 3 files attached.
