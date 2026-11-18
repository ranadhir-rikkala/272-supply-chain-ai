# ADR 0004: ETL is idempotent and quarantines bad input

Manifest checksums identify a processed file. Accepted rows are inserted with conflict-safe keys, while invalid rows and rejected files are retained with line numbers and reason codes. Replaying the same feed therefore changes no facts.
