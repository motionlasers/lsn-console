---
name: Append-only audit identity
description: Database integrity rules for audit records that must survive user deletion without becoming mutable.
---

An append-only audit stream must store actor identifiers as historical snapshots rather than foreign keys with `ON DELETE SET NULL`. It must also reject every runtime `UPDATE` and `DELETE`; a session-variable “maintenance” escape is not privileged in PostgreSQL and is therefore not a security boundary.

**Why:** A nulling foreign key mutates history during user deletion and trips strict immutability. A custom session setting can be enabled by the same database role, making an apparent append-only trigger bypassable.

Client idempotency keys must use a strict opaque format such as UUID and remain internal; do not project them from audit readers.

**Why:** An arbitrary client-supplied “identifier” can carry credentials or other sensitive text into immutable storage and disclose it to audit readers.

**How to apply:** Keep actor ID, username, and role snapshots independent of the live user row. Use an unconditional database trigger for runtime immutability. Validate idempotency keys at ingress and omit them from reader projections. If maintenance is ever required, it needs separate database credentials unavailable to the application.