#!/usr/bin/env bash
# Fails (exit 1) when any production source file under src/ contains an
# unchecked type cast (`as any` or `as unknown as`) that is not
# accompanied by a FIXME comment on the same line.
#
# Test-code casts under __tests__/ and in *.test.ts files are excluded
# on purpose — those exist to build minimal fixtures for unit tests and
# are not subject to the v2-client type-safety rule.
#
# Invoked by the `check:no-any` npm script and by .github/workflows/ci.yml.
# Also reproducible locally; zero dependencies beyond git and grep.

set -euo pipefail

MATCHES=$(
  git grep -nE '(as any|as unknown as)' -- 'src/*' \
    ':!src/**/__tests__/**' \
    ':!src/**/*.test.ts' \
    | grep -v 'FIXME' \
    || true
)

if [ -n "$MATCHES" ]; then
  echo "ERROR: Unchecked casts found in production source."
  echo ""
  echo "$MATCHES"
  echo ""
  echo "Every production cast to \`any\` or \`unknown\` must either be removed"
  echo "(prefer a tightened Zod schema or a typed adapter function in"
  echo "src/tools/adapters/) or documented inline with a FIXME comment and"
  echo "a URL pointing to an upstream issue in lunch-money-js-v2."
  echo ""
  echo "See src/tools/adapters/transactions.ts for the adapter pattern."
  exit 1
fi

echo "No unchecked casts in production source. OK."
