# Firmware Update Architecture

Local Console transfer and future AWS OTA are separate sources feeding one device-side update manager. Shared responsibilities are compatibility checks, package integrity and authenticity, inactive-slot writing, image verification, reboot, self-validation, acceptance, and rollback.

Firmware control traffic and maintenance transfer remain logically separate even though both use the physical Ethernet connection. The Console never hard-codes partition offsets.