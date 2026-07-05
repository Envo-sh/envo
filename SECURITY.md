# Security policy

Envo's client is open source precisely so its security claims can be
verified: secrets are encrypted with AES-256-GCM on your machine before
anything leaves it, ciphertext is bound to its environment context via GCM
AAD, and the hosted registry stores blobs it cannot decrypt. The
implementation lives in [`packages/core/src/crypto.ts`](packages/core/src/crypto.ts)
and is covered by the [ENVO-PACK specification](SPEC.md).

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting on this repository
("Security" tab → "Report a vulnerability"). We aim to acknowledge reports
within 48 hours. Please do not open public issues for security problems.

## Scope

This repository contains the Envo CLI and client library. The hosted
registry and web application (envo.sh) are closed source; vulnerabilities
affecting them may still be reported here privately.
