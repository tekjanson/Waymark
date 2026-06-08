#!/usr/bin/env bash
# test.sh — Quick health check for the waymark-dev-worker container.
#
# With no args: runs boot + auth suites (fast, no AI calls, ~30s).
#
# Use make targets instead of calling this directly:
#   make agent-test             # quick health check (boot + auth)
#   make agent-test-suite       # full E2E suite
#   make agent-test-suite ONLY=agent  # just agent tasks

exec bash "$(dirname "$0")/tests/run-tests.sh" --only boot,auth "$@"
