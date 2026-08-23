# NIBE HOOBS – Alarm Reset Implementation Instructions

## Current status

Phase 1 and Phase 2 are complete.

- The forked `homebridge-nibe` plugin builds successfully.
- GitHub Actions builds the project with Node.js 20.
- The generated `.tgz` contains the compiled `dist` output.
- The plugin is running successfully on HOOBS.
- Active myUplink notifications are being retrieved and logged.
- Existing NIBE accessory discovery/device-point behaviour must not be changed.

A real alarm response captured from the system is:

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

Therefore:
- NIBE alarm number = `229`
- myUplink notification ID = `43d1cf88-27bf-47b6-aa32-2dab3c87f38d`
- device ID = `emmy-r-153789-20240512-06922722004001-60-8a-10-71-cf-a4`

## Goal

Implement automatic reset of the myUplink alarm for:

**Alarm 229 – Short operating times for compressor**

The implementation must be conservative, safe, and bounded. It must never create an infinite reset loop.

## Phase 3 – Determine and implement the reset API

Before writing reset code:

1. Inspect the current `MyUplinkApiFetcher` implementation.
2. Inspect the myUplink public v2 Swagger/OpenAPI specification available to the project.
3. Identify the exact endpoint and HTTP method used to reset/acknowledge/clear an active notification.
4. Determine the exact request body, headers, path parameters, and expected response.
5. Do **not** guess the endpoint or request schema.

The notification `id` above is the candidate notification identifier required by the reset operation.

If the Swagger/API documentation does not clearly establish the reset endpoint, stop and report what is missing instead of inventing an API call.

## Phase 3A – Manual reset first

Implement a small, isolated method in the myUplink API layer following the existing authentication, HTTP client, logging, and error-handling patterns.

Conceptually:

```text
resetNotification(systemId, notificationId)
```

Requirements:

- Use the exact API contract discovered from Swagger.
- Return enough information to determine success/failure.
- Log API failures clearly.
- Do not automatically invoke it from the alarm polling loop yet.
- Do not add email notifications yet.
- Do not add a HomeKit alarm accessory.
- Do not change existing NIBE accessory behaviour.

## Phase 3B – Test reset manually

Before automatic reset:

1. Build and test the plugin.
2. Provide a safe development/test mechanism for invoking the reset method once.
3. Use the real notification ID only while alarm 229 is actually active.
4. Verify the API response.
5. Verify in myUplink/NIBE that the alarm becomes inactive.
6. Confirm the plugin subsequently reports no active alarm.

Do not repeatedly call the reset endpoint while testing.

## Phase 4 – Automatic reset logic

Only after manual reset is confirmed to work:

1. Consider only notifications where:
   - `status === "Active"`
   - `alarmNumber === 229`
   - the notification belongs to the configured/known NIBE system.
2. Never reset arbitrary alarms.
3. Attempt reset only once for a given notification initially.
4. If reset fails, retry only up to a small explicit limit.
5. Never create an infinite retry loop.
6. If repeated resets fail, leave the alarm active and report the failure.
7. If myUplink indicates a reset-limit/too-many-attempts condition, stop attempting.
8. After success, re-query active notifications to verify the notification is no longer active.
9. Do not repeatedly reset the same notification on every polling cycle.
10. Initially keep attempt state in memory unless persistence is demonstrably necessary.

Suggested state:

```text
notificationId
alarmNumber
attemptCount
lastAttemptTime
status
```

## Important distinction

Do not confuse:

```text
alarmNumber: 229
```

with:

```text
id: 43d1cf88-27bf-47b6-aa32-2dab3c87f38d
```

The first identifies the NIBE alarm type.

The second identifies the specific myUplink notification instance.

The reset operation should operate on the appropriate notification instance, not simply on the alarm number.

## Logging requirements

Use the existing plugin logging conventions.

Useful messages:

```text
Nibe active alarm 229 detected.
Nibe alarm 229 notification ID: <id>
Attempting to reset Nibe alarm 229.
Nibe alarm 229 reset request succeeded.
Verifying Nibe alarm 229 reset.
Nibe alarm 229 reset confirmed.
```

Failure examples:

```text
Nibe alarm 229 reset attempt failed: <reason>
Nibe alarm 229 reset retry limit reached.
Nibe alarm 229 could not be reset.
```

Never log credentials, access tokens, or other secrets.

## Testing

Preserve the existing test suite.

Run:

```bash
npm ci
npm run build
npm test
npm pack
```

The existing suite currently passes:

- 4 test suites
- 7 tests

Add unit tests for the reset/API logic where practical, especially:

- successful reset
- API failure
- malformed/unexpected response
- retry limit
- duplicate notification handling
- successful verification after reset

Do not modify unrelated tests just to make them pass.

## Scope restrictions

Do NOT implement yet:

- email
- Telegram
- push notifications
- HomeKit alarm accessory
- resetting alarms other than 229
- arbitrary notification deletion
- broad changes to NIBE accessory discovery
- changes to existing myUplink authentication

## Development principle

Work incrementally:

1. Identify exact reset API contract.
2. Implement isolated API method.
3. Test one manual reset.
4. Verify reset externally.
5. Add automatic alarm-229 handling.
6. Add retry/limit protection.
7. Add verification.
8. Only then proceed to notification delivery in a later phase.

Before making changes, explain the exact reset endpoint, HTTP method, request body, and response based on the Swagger/API documentation.
