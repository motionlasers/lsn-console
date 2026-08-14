# Protocol Map

The source of truth is `profiles/lsn-v0.1.json`. CIP class, instance, attribute, assembly, vendor, product, and enum numeric values remain intentionally unresolved.

Hardware Mode must reject any operation whose required mapping is null or `TBD`. Simulation transactions use symbolic mappings and are explicitly labeled as simulated evidence.

Implementation status tracks firmware bring-up (`TBD`, `IMPLEMENTING`, `TESTING`, `IMPLEMENTED`, `VERIFIED`) and is independent of validation results (`PASS`, `FAIL`, `WARNING`, `NOT TESTED`).