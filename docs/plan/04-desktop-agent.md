# 9. Electron Desktop Agent Architecture

## Process model

```text
┌──────────────────────────────── Main process (Node, privileged) ───────────────────────────────┐
│                                                                                                 │
│  AppController ── owns lifecycle, single-instance lock, tray/menu-bar, deep links (tallywork://)│
│      │                                                                                          │
│      ├── AuthService          PKCE login in system browser → loopback redirect → tokens         │
│      ├── DeviceService        keypair gen, registration, capability report, credential rotation │
│      ├── PolicyManager        fetch/cache policy, versioned; emits policy.changed to all svcs   │
│      ├── SessionManager       local mirror of server state machine; seq numbers; guards         │
│      │     ├── ActivityMonitor   uiohook-napi → per-second "had input" flags + kb/mouse COUNTS  │
│      │     ├── IdleDetector      powerMonitor.getSystemIdleTime() + ActivityMonitor             │
│      │     ├── ScreenshotService desktopCapturer per display, random-in-interval, blur, encode  │
│      │     ├── AppTracker        get-windows poll (1s) → spans (app name, bundle/exe id)        │
│      │     └── UrlTracker        Native Messaging host ← browser extension (domain/url)         │
│      ├── PowerWatcher         suspend/resume/lock-screen/unlock/shutdown → interrupt/resume     │
│      ├── OfflineQueue         encrypted SQLite (SQLCipher) outbox of events + screenshot files  │
│      ├── SyncEngine           batches, backoff, acks, clock-skew calc, upload scheduler         │
│      ├── NotificationManager  native notifications (idle prompt, limit, reminders, policy)      │
│      ├── Updater              electron-updater, signed, staged rollout channel from server     │
│      ├── CrashReporter        Sentry (no PII, no screenshots)                                   │
│      └── IpcRouter            ONLY place handling ipcMain; zod-validates every message          │
└──────────────────────────────────────────┬──────────────────────────────────────────────────────┘
                                           │ contextBridge (typed, minimal)
┌──────────────── Preload (isolated) ───────┴──────────┐
│ window.tallywork = {                                  │
│   auth: { login(), logout(), getAccount() },          │
│   timer: { start({projectId, taskId}), stop(),        │
│            pause(), resume(), onState(cb) },          │
│   catalog: { search(q), recent() },                   │
│   idle: { onPrompt(cb), resolve(id, choice) },        │
│   notes: { set(text) },                               │
│   status: { onSync(cb), onPolicy(cb) },               │
│   app: { openWeb(path), quit(), version() }           │
│ }   // no generic invoke(), no ipcRenderer exposure   │
└──────────────────────────────────────────────────────┘
┌──────────────── Renderer (sandboxed, React) ─────────┐
│ Timer · Project/Task search · Activity status ·       │
│ Work notes · Idle sheet · Settings · Sync status ·    │
│ "What is being monitored" transparency panel          │
└──────────────────────────────────────────────────────┘
```

## IPC contract
- Channels are defined once in `packages/validation/ipc.ts` as `{ channel, request: zodSchema, response: zodSchema }`.
- `IpcRouter` registers `ipcMain.handle` only for listed channels. It validates the payload, checks that `event.senderFrame.url` is the app's own origin (`app://`), and rejects anything else.
- Push updates from main use `webContents.send` on typed event channels; the preload wraps them in subscribe/unsubscribe functions.
- The renderer never sees tokens, file paths, or raw screenshots (thumbnails are served via a custom `app://thumb/<id>` protocol handler with an allowlist).

## Native integrations

| Capability | Windows | macOS | Linux (X11) | Linux (Wayland) |
|---|---|---|---|---|
| Idle time | `powerMonitor` ✓ | ✓ | ✓ | ✓ (via logind/`xprintidle` fallback) |
| Input counts | uiohook ✓ | uiohook, **needs Accessibility/Input Monitoring permission** | ✓ | ✗ (reported as unsupported; idle-only activity) |
| Screenshots | desktopCapturer ✓ | ✓ **needs Screen Recording permission** | ✓ | portal prompt; reported as limited |
| Active app | get-windows ✓ | ✓ (titles need Screen Recording) | ✓ | ✗ / limited |
| URLs | browser extension (all platforms); fallback Win UIA / macOS AppleScript for Chrome/Safari | | | extension only |

- The agent sends `capabilities` at registration and on change. The web UI shows per-device support, so managers never see "0% activity" that is really "not supported".
- On macOS, onboarding walks through the permission prompts and re-checks them at every session start (`systemPreferences.isTrustedAccessibilityClient`, `getMediaAccessStatus('screen')`).

### Activity measurement (privacy-preserving)
- The uiohook callback does exactly one thing: increment `kbCount` or `mouseCount` for the current second and set `hadInput[sec] = true`. The key code/char is **never read into a variable that persists**. A unit test and a code-review rule guard this.
- Every 60s the monitor emits an `activity.minute {minute_start, keyboard_count, mouse_count, active_seconds}`. Mouse movement is sampled (at most 1 count per 100ms) so it does not swamp keyboard counts.
- Listening only happens while the session is ACTIVE. The hook is started and stopped with the session, not left running.

### Idle
- The threshold comes from policy (default 5 min). When `idle ≥ threshold`, the agent retroactively marks idle as starting at the last input, sends `REPORT_IDLE started`, and pauses or continues per `idle_behavior`.
- When the user returns, the idle sheet asks Keep / Discard / Assign-to-task (options offered per policy). The answer is sent as `REPORT_IDLE resolved`. With no answer before `idle_confirmation_timeout`, the default resolution from policy applies. The raw idle event is always kept.

### Screenshots
- The interval comes from policy (e.g. 1–3 per 10 min). The capture time is random within each slot, and every display is captured.
- Pipeline: capture → optional **blur at source** (sharp, Gaussian) → encode WebP q70 → sha256 → store encrypted in the queue dir → upload-intent → presigned PUT → confirm → delete the local copy.
- A small, subtle notification ("Screenshot taken", per policy) supports transparency. The worker can review and, if policy allows, delete a screenshot within N minutes. Deletion removes the matching time when `delete_removes_time` is set.

## Offline queue & sync engine

```text
event produced ──▶ OfflineQueue.append (SQLite tx: {event_id uuidv7, seq, type, payload,
                                        wall_ts, mono_ms, attempts=0, status=PENDING})
                         │
SyncEngine loop ◀────────┘ (trigger: new event, 10s tick, network 'online', resume)
   1. take up to 200 PENDING ordered by (session_id, seq)
   2. POST /ingest/batch  (Idempotency by event_id; device-signed request)
   3. per-event ack: accepted|duplicate → delete ; rejected(reason) → move to DEAD + surface
   4. response carries server_time → update skew = server_time - (wall_ts at send)
   5. failure → exponential backoff with jitter (1s → 5 min cap); 401 → refresh token once
   6. screenshots uploaded by separate lane (bandwidth-limited, lower priority)
```

- **Encryption.** The SQLite DB uses SQLCipher. Its key is random, wrapped with `safeStorage` (DPAPI / Keychain / libsecret). Screenshot files are AES-GCM encrypted with the same key.
- **Limits.** The queue is capped by policy (`max_offline_tracking`, default 24h). When it is exceeded, the agent stops tracking and tells the user, rather than growing the queue without bound.
- **Crash safety.** Because every event is committed to SQLite before being acted on, a crash or restart recovers the local session. On restart the agent sends `session.interrupted` evidence (last activity minute) and asks the user whether to resume.

## Auto updater
- electron-updater with a generic provider (our update server / S3). The server returns the channel (stable/beta) and `min_supported_version` per org.
- Signed builds: Windows (Authenticode, EV cert), macOS (Developer ID + notarization, hardened runtime), Linux (AppImage + deb/rpm with GPG-signed repo). The updater verifies signatures before applying.
- Updates are never applied during an ACTIVE session. Forced updates (security) stop the session first, and the user is informed.

## Electron security checklist
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, `allowRunningInsecureContent: false`, `enableRemoteModule` absent.
- Strict CSP on renderer HTML: `default-src 'self'; script-src 'self'; connect-src 'self'` (the renderer makes no direct network calls; everything goes through main).
- `setWindowOpenHandler` → deny, and open allowed https links in the external browser. `will-navigate` is blocked.
- A custom `app://` protocol serves bundled assets (no `file://`).
- Tokens are kept only in main memory plus `safeStorage`-encrypted at rest. Access tokens last 10 min; the device refresh token rotates.
- Electron Fuses: disable `RunAsNode`, `EnableNodeCliInspectArguments`, and `EnableNodeOptionsEnvironmentVariable`; enable `EnableEmbeddedAsarIntegrityValidation` and `OnlyLoadAppFromAsar`.
- Dependencies are pinned; `npm audit` and Electron version currency run in CI. Electron is upgraded within 4 weeks of each security release.
- Least privilege: no admin/root install is required for per-user installs. An MDM-deployable machine-wide installer is offered separately.

## Transparency UX in the agent
- A tracking-state pill (colour **and** text) is always visible. The tray icon changes by state.
- The "Monitoring on this device" panel lists exactly what the current policy collects: Activity ✓, Screenshots every ~10 min (blurred), Apps ✓, URLs: domains only, Location ✗. The worker must acknowledge on first run and on each policy version change (acknowledgements are stored in `policy_acks`).
- Nothing is collected while stopped. The monitors are not even subscribed.
