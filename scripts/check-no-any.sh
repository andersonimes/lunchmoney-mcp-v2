#!/usr/bin/env bash
# Regression gate: fails when any production source file under src/
# contains an unchecked type cast (`as any` or `as unknown as`) that
# is not accompanied by an explicit `CAST-ALLOWED:` marker comment
# on the same line.
#
# Why a dedicated `CAST-ALLOWED:` marker rather than a generic
# `FIXME`: a stray `FIXME` comment anywhere on the same line (about
# something entirely unrelated) would otherwise let a cast through
# by accident. `CAST-ALLOWED:` must be followed by a justification
# — either a URL to an upstream type-bug issue, or a one-line
# rationale — and it exists for no other purpose, so accidental
# collisions are impossible.
#
# Expected allowlist usage:
#   foo.bar = value as unknown as T; // CAST-ALLOWED: https://github.com/.../issues/123
#
# Test-code casts under __tests__/ and in *.test.ts files are
# excluded on purpose — those exist to build minimal fixtures for
# unit tests and are not subject to the v2-client type-safety rule.
#
# The regex uses word boundaries (`\bas any\b`) to avoid false
# positives on literal strings like `fastasany` or identifiers that
# happen to contain `as any` as a substring.
#
# Scope: this is a single-line check. Multi-line `as` casts
# (`foo as\n  any`) are not committed in this repository because
# Prettier normalises whitespace around type operators, collapsing
# such casts onto a single line. A multi-line cast would only reach
# the repository if a contributor deliberately disables formatting,
# which is a separate policy concern not enforced by this script.
#
# Invoked by the `check:no-any` npm script and by
# .github/workflows/ci.yml. Zero dependencies beyond git and grep.

set -euo pipefail

MATCHES=$(
  git grep -nE '\bas any\b|\bas unknown as\b' -- 'src/*' \
    ':!src/**/__tests__/**' \
    ':!src/**/*.test.ts' \
    | grep -v 'CAST-ALLOWED:' \
    || true
)

if [ -n "$MATCHES" ]; then
  echo "ERROR: Unchecked casts found in production source."
  echo ""
  echo "$MATCHES"
  echo ""
  echo "Every production cast to \`any\` or \`unknown\` must either be removed"
  echo "(prefer a tightened Zod schema or a typed adapter function in"
  echo "src/tools/adapters/) or documented inline with a CAST-ALLOWED:"
  echo "comment and a URL pointing to an upstream issue in lunch-money-js-v2."
  echo ""
  echo "Expected allowlist usage:"
  echo "  foo.bar = value as unknown as T; // CAST-ALLOWED: https://github.com/.../issues/NNN"
  echo ""
  echo "See src/tools/adapters/transactions.ts for the adapter pattern."
  exit 1
fi

echo "No unchecked casts in production source. OK."
