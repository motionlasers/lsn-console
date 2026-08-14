# Local OTA Workflow

The Console validates device identity, hardware and protocol compatibility, package integrity, and disabled control state before transfer. It then tracks transfer, image verification, inactive-slot write, boot selection, reboot, rediscovery, version verification, runtime persistence, EtherNet/IP checks, and Basic Validation.

Simulation includes interrupted transfer, corruption, checksum failure, incompatible targets, validation failure, power interruption around boot selection, disappearance during reboot, known-good recovery, and rollback. These are engineering simulations, not proof of every physical power-loss behavior.