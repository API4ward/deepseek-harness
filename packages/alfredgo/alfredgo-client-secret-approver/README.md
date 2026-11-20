---
description: "AlfredGo credential approver in the DHS client: device keys, encrypted credentials, injector pairing, and approval cards for AgentSecret."
kind: "package-reference"
---

# @deepseek-ai/dsh-alfredgo-client-secret-approver

English | [中文](README.zh.md)

## Summary

This browser plugin makes the DHS client an [AgentSecret](https://github.com/API4ward/AgentSecret) approver. It keeps the user's credentials in this browser, encrypted under a key that cannot be exported, and asks the user before an agent uses one. Approval cards float over DHS while requests are pending; the **Credential approvals** settings page holds the device, the relay connection, paired injectors, credentials, and approval modes. The [relay forwarder](../alfredgo-secret-approver/README.md) carries its calls to the relay. Injection into the agent is the separate optional [secret-guard](../alfredgo-secret-guard/README.md) plugin.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Load both packages in a profile with an overlay:

```yaml
- insert:
    - id: alfredgo-secret-approver
      name: '@deepseek-ai/dsh-alfredgo-secret-approver'
      config:
        relayUrl: http://127.0.0.1:8780
    - id: alfredgo-client-secret-approver
      name: '@deepseek-ai/dsh-alfredgo-client-secret-approver'
```

Then open **Settings › Credential approvals**:

1. Enter the AgentSecret user name and create the device key. Injectors pair only with devices of the same user.
2. Copy the shown commands to register the device on the relay and on the injector (`agentsecret relay device-register`, `agentsecret injector pair-approver`), then connect.
3. Paste the injector's pairing data (`agentsecret injector pairing`) and pair it.
4. Store credentials. Each saved change publishes matchers that let the injector recognise a credential without holding it.

While DHS is open and connected, the client fetches pending requests every two seconds. A card shows the project, credentials, tool, target, and operation, with **Deny**, **Allow once**, and **More…** (allow 3 or 10 times, or for 3 minutes, 10 minutes, or 1 hour). For a fill or an MCP use, the value returned can be the stored credential, a named copy, a mock of the same shape, or typed text. Requests this device can never approve, such as an unknown alias or an unpaired injector, are refused at once with a signed reason and listed under automatic decisions. Approve-all mode and automatic rules (kind, alias, tool, and target globs) answer for the user; each answer is still a signed decision.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`src/client/approver.ts`](src/client/approver.ts) is a port of AgentSecret's `web/approver.js`; [`src/client/crypto.ts`](src/client/crypto.ts) holds the WebCrypto primitives (ECDSA P-256 signatures, ECIES sealing with HKDF-SHA256 and AES-256-GCM, PBKDF2 matchers) that match AgentSecret's `seal.py` and `matcher.py`. Signed texts use the prefixes `secret-guard/request/v1:`, `secret-guard/decision/v3:`, and `secret-guard/rules/v1:`. A sealed value is bound to the SHA-256 of the request text and addressed to the encryption key recorded at pairing, never to a key the relay supplies.

[`src/client/store.ts`](src/client/store.ts) keeps the device, credentials, injectors, and modes in the IndexedDB database `alfredgo-secret-approver`, separate from AgentSecret's own page. [`src/client/index.ts`](src/client/index.ts) mounts the forwarder's Remote namespace, registers the `settings.section` page and the `shell.overlay` cards, and owns the polling timer.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Relay forwarder](../alfredgo-secret-approver/README.md) — the Host half.
- [secret-guard](../alfredgo-secret-guard/README.md) — optional reveal, `secret_write_file`, and MCP for the agent.
- [AgentSecret split deployment](https://github.com/API4ward/AgentSecret/blob/main/docs/split-architecture.md) — approver, relay, injector, and the approval protocol.

-----

<a id="model-experience"></a>
## Model Experience

None, as the approver runs in the browser and adds nothing to model requests.

#### KV Cache effect

No direct effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Credentials exist only in this browser profile. Clearing site data loses them; there is no backup or recovery, and no biometric confirmation per approval.
- Requests are fetched by polling, so DHS must stay open for approvals and approval modes to apply.
- The settings page cannot detect `agentsecret injector pair-approver` or `injector serve`; it shows their commands.
- `src/client/store.ts` IndexedDB access and the React views have no unit coverage yet.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`tests/approver.client.spec.ts` runs the approver against a fake relay and a fake injector that verify every signature and open every sealed box. The design is recorded in `alfredgo/designs/AG-2-secret-manager.md` (design v3).

</details>
