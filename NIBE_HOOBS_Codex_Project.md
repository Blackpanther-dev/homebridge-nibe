# NIBE / HOOBS Automatic Alarm Reset Project

## Objective

Extend `homebridge-nibe` so the user's HOOBS server can automatically handle the NIBE **Short operating time** alarm in cooling mode.

Target system:
- NIBE VVM 225 E EM 3×400 V
- Outdoor unit: NIBE F2120-8
- VVM 225 software: 9727R3
- F2120 software: 10677
- Target alarm: **229 – Short operating time**

Desired automation:
1. Detect active alarm 229.
2. Obtain the corresponding myUplink notification ID.
3. Reset that notification through myUplink.
4. Verify that the alarm clears.
5. Avoid endlessly resetting if the alarm immediately returns; eventually notify the user.

## Environment

- Raspberry Pi running HOOBS.
- HOOBS is already working.
- Existing integrations (including Ring) must not be broken.
- User has recovered the HOOBS web username/password.
- Preferred implementation: fork `hp-net/homebridge-nibe`.

Repository:
https://github.com/hp-net/homebridge-nibe

## Development strategy

Do not modify the installed HOOBS plugin directly.

1. Fork `homebridge-nibe` into the user's GitHub account.
2. Clone the fork locally.
3. Build the fork **unchanged** first.
4. Install the user's own build on HOOBS.
5. Confirm it works like the upstream plugin.
6. Add alarm detection first.
7. Inspect the real myUplink notification response.
8. Only then implement alarm reset.
9. Build/reinstall the modified plugin.
10. Test with alarm 229.

## myUplink API

Swagger:
https://api.myuplink.com/swagger/docs/public-v2/swagger.json

Relevant endpoints identified:
- `GET /v2/systems/{systemId}/notifications/active`
- `GET /v2/systems/{systemId}/notifications`
- `POST /v2/systems/{systemId}/notifications/{notificationId}/reset` (path appears in the public OpenAPI spec, but the method details must be verified against a real API response before relying on it)

Important: `notificationId` is the actual myUplink notification identifier and must not be assumed to equal NIBE alarm number 229.

We need to inspect the actual notification JSON and distinguish:
- `alarmId`: expected to identify NIBE alarm 229
- `id`: actual myUplink notification ID used by the reset endpoint

## Existing plugin findings

`homebridge-nibe` already:
- Uses myUplink.
- Supports myUplink authentication/API credentials.
- Has API communication infrastructure.
- Supports READSYSTEM / WRITESYSTEM capabilities.
- Has generic device-point write support.
- Has a `showApiResponse` configuration option useful for debugging.

It currently does not appear to implement:
- myUplink notification retrieval
- active alarm accessories
- notification reset

Relevant source areas:
- `src/platform/myuplink/MyUplinkApiFetcher.ts`
- `src/platform/myuplink/MyUplinkApiModel.ts`
- `src/platform/NibePlatform.ts`
- accessory implementations under `src/platform/nibeaccessory`

## Implementation phases

### Phase 1 — Baseline

Build and install the unmodified fork. Confirm:
- Plugin starts.
- myUplink authentication works.
- VVM 225/F2120 are detected.
- Existing HOOBS/HomeKit accessories remain functional.

### Phase 2 — Alarm inspection

Add a read-only method such as `getActiveNotifications()`.

Use the appropriate notification endpoint and log the notification object for alarm 229.

Determine the exact JSON structure and notification IDs.

### Phase 3 — Reset

Add a method such as `resetNotification(systemId, notificationId)`.

Call:
`POST /v2/systems/{systemId}/notifications/{notificationId}/reset`

Then query active notifications again and verify that alarm 229 has cleared.

### Phase 4 — Automation

Initial conservative logic:
- Detect alarm 229.
- Check that it is still active.
- Reset once.
- Verify.
- If it immediately returns, limit retries.
- Do not continuously reset a persistent fault.
- Log/expose a persistent alarm so the user knows manual intervention is required.

Repeated automatic resetting could mask a genuine heat-pump fault, so retry limits are important.

## Next task

Start with **forking `homebridge-nibe`, cloning it, building the unmodified fork, and installing/testing that build on HOOBS**.

Do not implement alarm-reset logic until the baseline build is confirmed.
