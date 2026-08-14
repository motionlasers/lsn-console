# Device Profile Schema

Device Profiles are versioned JSON documents validated by `schemas/device-profile.schema.json`.

Each field carries its symbolic name, direction, type, access, optional CIP/assembly mapping, **firmware implementation status**, **simulation validation status**, expected firmware behavior, expected response, and notes. These statuses are independent: simulator success never advances the real WT32-ETH01 firmware status. The app derives the firmware-facing interface specification directly from this data so profile edits and the engineer checklist remain synchronized.