# NIBE HOOBS — Automatic Alarm Reset Development Plan

## Project objective

Extend the forked `homebridge-nibe` plugin to automatically reset the NIBE/myUplink alarm:

**Alarm 229 — Short operating times for compr.**

The plugin must detect the active alarm, automatically attempt the reset through the myUplink API, verify the result, and log the outcome.

There will be **no HOOBS UI reset button**. The reset is intended to be fully automatic.

User notifications (email, Telegram, push, etc.) are deferred to a later phase.

---

## Current status

### Phase 1 — Baseline: COMPLETE

- Forked `homebridge-nibe` repository.
- Version bumped.
- Github build successfully tested.
- Github built plugin successfully installed and working on HOOBS.
- Existing NIBE accessories are detected normally.

### Phase 2 — Alarm detection: COMPLETE

The plugin can retrieve active myUplink notifications.

A real alarm response has been captured:

```json
{
  "id": "43d1cf88-27bf-47b6-aa32-2dab3c87f38d",
  "alarmNumber": 229,
  "deviceId": "emmy-r-153789-20240512-06922722004001-60-8a-10-71-cf-a4",
  "severity": 1,
  "status": "Active",
  "createdDatetime": "2026-08-23T17:05:11+0",
  "statusHistory": [],
  "header": "Short operating times for compr.",
  "description": "This alarm was generated from the heat pump.\r\nFirst try to reset the alarm. If the alarm recurs, see the heat pumps manual for more information.",
  "equipName": "EB101-EP14"
}
```

Important values:

- `alarmNumber`: `229`
- notification `id`: `43d1cf88-27bf-47b6-aa32-2dab3c87f38d`
- `deviceId`: `emmy-r-153789-20240512-06922722004001-60-8a-10-71-cf-a4`
- `status`: `Active`

The notification retrieval and logging are working.

---

# Phase 3 — Automatic alarm reset

## Goal

When an active myUplink notification with:

```text
alarmNumber === 229
status === "Active"
```

is detected for the configured NIBE system, the plugin should automatically attempt to reset it.

The result must be logged using the plugin's existing **info-level logging convention**.

No UI element should be added.

No manual reset mechanism should be added.

---

## Phase 3.1 — Determine the exact reset API

Before implementing the reset request:

1. Inspect the existing `MyUplinkApiFetcher` implementation.
2. Inspect the myUplink public v2 Swagger/OpenAPI specification.
3. Identify the exact API operation for resetting/acknowledging/clearing an active notification.
4. Determine:
   - HTTP method
   - endpoint
   - path parameters
   - request body
   - required headers
   - response format
   - relevant HTTP status codes
5. Reuse the existing authentication and HTTP request infrastructure.

### Important

Do **not** guess the reset endpoint or request format.

Do not assume that the alarm number itself is used by the reset endpoint.

The alarm has two distinct identifiers:

```text
alarmNumber = 229
id = 43d1cf88-27bf-47b6-aa32-2dab3c87f38d
```

The alarm number identifies the alarm type.

The notification ID identifies the specific myUplink notification instance.

Use whichever identifier the actual API contract requires.

If the Swagger/API documentation does not establish the reset operation with sufficient confidence, stop and report the missing information rather than inventing an endpoint.

---

## Phase 3.2 — Implement automatic reset

Implement the reset functionality in the myUplink API layer and integrate it with the existing active-notification handling.

Conceptually:

```text
getActiveNotifications()
        ↓
find active alarm 229
        ↓
resetNotification(...)
        ↓
verify with getActiveNotifications()
```

### Detection rules

Only automatically reset notifications satisfying all relevant conditions:

```text
status === "Active"
alarmNumber === 229
notification belongs to the configured NIBE system
```

Do not reset other alarm numbers.

Do not reset inactive notifications.

---

## Phase 3.3 — Bounded retry handling

The implementation must not create an endless reset loop.

For each notification instance:

- Track the notification ID.
- Track reset attempts.
- Use a small explicit maximum attempt count.
- Do not retry indefinitely.
- Do not attempt the same reset repeatedly on every polling cycle.

Suggested in-memory state:

```text
notificationId
alarmNumber
attemptCount
lastAttemptTime
```

The exact retry count and timing should be chosen based on the API behaviour and existing polling interval.

### Reset-limit/API refusal

If myUplink reports that the reset cannot be performed because of a reset limit, too many attempts, or another explicit refusal:

- stop retrying that notification
- leave the alarm active
- log the failure clearly at info level

---

## Phase 3.4 — Verification

A successful HTTP response alone is not sufficient.

After a successful reset request:

1. Query active notifications again.
2. Search for the same notification.
3. Confirm that alarm 229 is no longer active.

Possible outcomes:

### Reset confirmed

```text
Nibe alarm 229 detected.
Nibe alarm 229 reset requested.
Nibe alarm 229 reset confirmed.
```

### Reset request failed

```text
Nibe alarm 229 detected.
Nibe alarm 229 reset failed: <reason>.
```

### Reset request succeeded but alarm remains active

```text
Nibe alarm 229 reset request succeeded, but alarm remains active.
```

Then apply the bounded retry policy.

---

## Logging

Use the plugin's existing logging implementation.

The automatic-reset events should be logged at **info level** so they are visible in normal HOOBS logs.

Recommended messages:

```text
Nibe active alarm 229 detected: Short operating times for compr.
Nibe alarm 229 notification ID: <id>
Attempting automatic reset of Nibe alarm 229.
Nibe alarm 229 reset request succeeded.
Nibe alarm 229 reset confirmed.
```

Failure cases:

```text
Nibe alarm 229 reset attempt failed: <reason>
Nibe alarm 229 remains active after reset attempt.
Nibe alarm 229 reset retry limit reached.
Nibe alarm 229 cannot be reset because the API rejected further attempts.
```

Never log:

- access tokens
- passwords
- API credentials
- other secrets

---

## Phase 3.5 — Version bump

### Version

Change:

```text
2.1.2-2
```

to:

```text
2.1.2-3
```

---

# No HOOBS UI

This project does **not** require a HOOBS UI control for resetting the alarm.

Do not add:

- reset buttons
- configuration fields for manual reset
- HomeKit alarm accessories
- UI pages
- manual reset commands

The reset should happen automatically when the active alarm is detected.

---

# Development sequence

Follow this order:

1. Identify the exact myUplink reset API from Swagger.
2. Implement the isolated reset API method.
3. Integrate it with active alarm 229 detection.
4. Automatically attempt the reset.
5. Log the result at info level.
6. Re-query and verify the alarm state.
7. Add bounded retry handling.
8. Add tests.
9. **bump the version from `2.1.2-2` to `2.1.2-3`.**


## Important constraints

- Do not change existing NIBE accessory discovery, authentication, or device-point behaviour unless required by the reset implementation.
- Do not implement a manual reset UI.
- Do not implement notifications in Phase 3.
- Do not reset alarms other than alarm 229.
- Do not guess undocumented API behaviour.
- Do not create an unbounded reset/retry loop.
