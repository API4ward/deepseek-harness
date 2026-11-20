---
description: "AlfredGo relay forwarder on the DHS Host: carries the browser approver's calls to the AgentSecret relay."
kind: "package-reference"
---

# @deepseek-ai/dsh-alfredgo-secret-approver

English | [中文](README.zh.md)

## Summary

This Host plugin forwards the [credential approver](../alfredgo-client-secret-approver/README.md) in the DHS client to an [AgentSecret](https://github.com/API4ward/AgentSecret) relay. The relay accepts only same-origin browser requests, so the client cannot call it directly; the Remote namespace `secretApprover` posts each call from the Host instead. Bodies pass through unchanged: they hold only signed texts and sealed boxes, never a credential in plain text.

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

Load it together with the client package and set the relay address:

```yaml
- insert:
    - id: alfredgo-secret-approver
      name: '@deepseek-ai/dsh-alfredgo-secret-approver'
      config:
        relayUrl: http://127.0.0.1:8780
    - id: alfredgo-client-secret-approver
      name: '@deepseek-ai/dsh-alfredgo-client-secret-approver'
```

`relayUrl` is the address that `agentsecret relay serve` prints; it defaults to `http://127.0.0.1:8780`. When the relay cannot be reached or answers with something other than JSON, the settings page reports that the relay is unreachable.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`src/index.ts`](src/index.ts) is a `TypertRemoteService` with two methods. `info()` returns the configured relay address. `relay(call)` accepts only the approver routes (`/device/challenge`, `/device/login`, `/approver/rules`, `/approver/pending`, `/approver/decision`) and bodies up to 1 MiB, posts the body as JSON with the optional bearer token, refuses redirects, and returns the relay's status and body text. A refused route or body fails with `gateway/bad-request`; a network error or a non-JSON answer fails with `secret-approver/relay-unreachable`. Session tokens and bodies are not logged.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Credential approver](../alfredgo-client-secret-approver/README.md) — the client half.
- [AgentSecret split deployment](https://github.com/API4ward/AgentSecret/blob/main/docs/split-architecture.md) — the relay routes and the approval protocol.

-----

<a id="model-experience"></a>
## Model Experience

None, as the forwarder serves the client and adds nothing to model requests.

#### KV Cache effect

No direct effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Only one relay per DHS Host; the address is fixed by configuration.
- The relay is AgentSecret's Python relay; a relay inside DHS is deferred.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`tests/forwarder.spec.ts` covers the route allowlist, the body limit, bearer forwarding, and unreachable or non-JSON relays with a fake `fetch`. The design is recorded in `alfredgo/designs/AG-2-secret-manager.md` (design v3).

</details>
