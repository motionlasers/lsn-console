# Adding LSN Modules

A module may contribute symbolic status fields, commands, diagnostics, tests, Device Profile mappings, logs, reports, and UI metadata.

The disabled `sensor-example` module demonstrates simulated Sensor 1, Sensor 2, Temperature, and Sensor Fault without implying that this hardware exists. New modules must preserve the logical hardware abstraction and must not introduce GPIO numbers into the external protocol model.