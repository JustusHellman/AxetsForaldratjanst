# Security Specification for Preschool Cooperative Scheduling

## 1. Data Invariants
- Cooperative configs in `/coop/{coopId}` must have valid alphanumeric IDs of length <= 64.
- Wishes in `/wishes/{coopId}` must match the corresponding cooperative ID and maintain valid wish records.
- Schedules in `/schedules/{coopId}` must match the corresponding cooperative ID.
- No documents outside `/coop/`, `/wishes/`, and `/schedules/` are accessible (Default Deny).
- Payloads must respect maximum size limits to avoid denial-of-wallet / resource exhaustion attacks.

## 2. Dirty Dozen Payloads (Designed to test boundaries)
1. Write to unauthorized collection `/system_secrets/keys` -> PERMISSION_DENIED
2. Write with non-alphanumeric cooperative ID `/coop/invalid$id!#` -> PERMISSION_DENIED
3. Oversized ID injection (string > 128 chars) `/coop/...` -> PERMISSION_DENIED
4. Attempt to write to `/admin_credentials/coop` -> PERMISSION_DENIED
5. Overwriting root documents `/{document=**}` -> PERMISSION_DENIED
6. Malformed collection path traversal `/coop/../secrets` -> PERMISSION_DENIED
7. Write to non-existent subcollection `/coop/{coopId}/private/passwords` -> PERMISSION_DENIED
8. Delete attempts on global databases `/databases/` -> PERMISSION_DENIED
9. Injection in `/wishes/{coopId}` with invalid ID characters -> PERMISSION_DENIED
10. Path variable poisoning with SQL/NoSQL injection tokens `{"$gt": ""}` -> PERMISSION_DENIED
11. Querying unauthorized collections `/users` -> PERMISSION_DENIED
12. Attempt to list collections outside the schema -> PERMISSION_DENIED
