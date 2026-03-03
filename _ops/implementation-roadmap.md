# Omni Smart Devices Implementation Roadmap

## Goal
Provide a general, extensible device integration layer for Omni that supports AwoX HomeControl (BLE mesh) now and other device types later, with a unified status/on-off/dimming API exposed over WebSocket.

## Assumptions
- Omni server has Bluetooth access (built-in or USB dongle) and is physically near the lamps.
- AwoX HomeControl devices are Bluetooth Mesh (typical for this app).
- Pairing and control will be done via Omni, not the mobile app.

## Phase 0 - Discovery and Constraints
1. Confirm hardware
   - Verify Omni server has working BLE adapter.
   - Confirm range and placement near devices.
2. Identify target device capabilities
   - On/off, dim only (no color for this scope).
3. Decide on gateway topology
   - Local gateway on the Omni server (preferred for low latency).

## Phase 1 - Core Device Abstraction
1. Define a device model
   - id, name, type, capabilities, status, lastSeen
2. Define a unified command set
   - power: on/off
   - brightness: 0-100
3. Define device events
   - statusChanged, deviceDiscovered, deviceOffline

## Phase 2 - Server Driver Layer
1. Create a driver interface
   - init(), scan(), pair(), getStatus(), setPower(), setBrightness(), subscribe()
2. Driver registry
   - BLE, Zigbee, Wi-Fi/cloud (future)
3. WebSocket contract
   - Device list push
   - Status updates push
   - Command request/response

## Phase 3 - AwoX BLE Mesh Driver (MVP)
1. BLE mesh discovery
   - Scan for AwoX mesh devices
2. Pairing flow
   - Pair devices through Omni, store keys securely
3. Status polling/subscription
   - Track on/off and brightness
4. Command execution
   - on/off and dim

## Phase 4 - UI Integration
1. Device list view
   - Show status and lastSeen
2. Controls
   - Toggle on/off
   - Dim slider
3. Real-time updates
   - WebSocket events update UI

## Phase 5 - Reliability and Observability
1. Auto-reconnect for BLE adapter
2. Device health tracking
   - Last seen timestamps, offline states
3. Logging
   - Driver-level logs for pairing and commands

## Phase 6 - Expansion to Other Devices
1. Zigbee driver path
   - USB coordinator, similar device model
2. Wi-Fi/cloud path
   - Vendor-specific API adapters
3. Device capability mapping
   - Map color/scene for future devices without breaking current UI

## Deliverables
- Server driver interface and registry
- BLE mesh driver for AwoX HomeControl devices
- WebSocket API for device list and control
- Client UI components for status, on/off, dimming
- Ops documentation and pairing instructions

## Risks and Mitigations
- BLE mesh complexity: start with a small set of devices to validate pairing and command reliability.
- Range and stability: use a dedicated BLE adapter and place Omni server centrally.
- Vendor protocol changes: keep driver isolated and versioned.

## Next Actions
1. Confirm BLE hardware availability on the Omni server.
2. Confirm pairing flow requirement (Omni-only vs mobile app fallback).
3. Decide where to store device credentials (file vs database).