# WT32-ETH01 Platform

The current controller uses an ESP32, LAN8720A PHY, RMII Ethernet, and the built-in 10/100BASE-T RJ45. The existing LSN daughterboard is established working hardware and is not redesigned or reverse-engineered by the Console.

The Console operates on logical LSN states. Firmware maps those states to the daughterboard through its hardware-abstraction layer.