# Regression Investigation

When a historical regression is suspected:

1. Reproduce the bug at HEAD.
2. Encode the reproduction as an automated regression test.
3. Confirm the test fails at HEAD.
4. Confirm the test passes at `known-good`.
5. Create a minimal executable test command suitable for `git bisect run`.
6. Run:

   ```bash
   git bisect start
   git bisect bad HEAD
   git bisect good known-good
   git bisect run <regression-test-command>
   ```

7. Inspect the first bad commit.
8. Identify the violated invariant/root cause.
9. Choose repair-forward or rebuild-from-known-good according to
   `docs/DEVELOPMENT_CONTRACT.md`.
10. After investigation:

    ```bash
    git bisect reset
    ```

Do not use bisect when no deterministic GOOD/BAD test exists.

The bisect command must:

```text
exit 0      when behavior is GOOD
exit !=0    when behavior is BAD
exit 125    when the commit cannot be tested
```

Bisect wrapper scripts live in this directory and test one regression as
directly as practical. They must be non-destructive and must not modify the
working tree.
