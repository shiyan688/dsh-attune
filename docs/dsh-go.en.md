# DSH Go and other mobile clients

[简体中文](dsh-go.md) · [English README](../README.en.md)

Attune stores questions, preferences, and supporting answers on the DSH host. Apps connected to the same host use the same archive. A phone running its own local engine and a computer running another host keep separate archives.

## DSH Go

Attune ships a Web client, a DSH Go native panel, and `/attune` commands. The native panel uses the `dshGo` manifest and registers through `ctx.dshGo.panel` when the host exposes that bridge.

| Connection | Native panel | Slash commands | Web panel |
| --- | --- | --- | --- |
| Local phone engine | Available with the bridge | Available | Available |
| SSH host | Bridge currently unavailable | Available | Use DSH Go's Web panel when enabled. |
| Relay host | Relay does not expose the bridge | Depends on the remote command support | Unavailable over relay |

See the upstream [host coverage](https://github.com/ccch1mneyyy/dsh-Go/blob/main/docs/plugins/hosts.md), [slots](https://github.com/ccch1mneyyy/dsh-Go/blob/main/docs/plugins/slots.md), and [actions](https://github.com/ccch1mneyyy/dsh-Go/blob/main/docs/plugins/actions.md). The native client renders bounded JSON components and sends quiz actions to the host.

With a v2 panel, you can enter the current situation, paste an excerpt and say what felt off, or add feedback to a tone quiz. In a v1 panel, tapping Generate starts from the host's known preferences and open questions. To provide context from chat, paste the relevant bit into the panel or use `/attune test <situation>` or `/attune excerpt <text>`.

Review the proposal after answering and choose which personas should remember it. The host chooses the relevant persona when replying. Use `/attune personas` for IDs, `/attune remember <proposalId> ideas,review` for a preference shared across personas, and `/attune persona-review` to review persona suggestions. The full command list is in the [English README](../README.en.md#use-slash-commands).

## DSHA and Whaleness

- **[DSHA](https://github.com/DSH-APP/DSHA)** runs DSH locally on Android and displays its Web UI. Install Attune in the Web profile that the app uses.
- **[Whaleness](https://github.com/Clarklevis1995/dsh-mobile)** connects its Android and iOS apps to a computer running DSH with [Mobile Gateway](https://github.com/Clarklevis1995/dsh-plugin-mobile-gateway). Install Attune on that host and use its slash commands from the app.
- **Desktop and browser** use the same standard Web plugin. Install it in the appropriate profile for each entry point. Attune calls its API relative to the DSH page or window, including when Web is served under a subpath.

## Companion and tone quizzes

| Client | Companion | Tone preferences |
| --- | --- | --- |
| DSH Web and official Desktop | Animated companion inside the DSH window | **Teach me how to ask** and `/attune tone` |
| DSHA with standard Web UI | Companion within the touch-friendly Web panel | Web controls and slash commands |
| DSH Go native panel | Companion status messages, cards, and buttons | Tone quiz and slash commands |
| Whaleness and command-only connections | Text-based interaction | `/attune tone` followed by confirm, correct, or delete |

Custom image uploads use the Web interface. See [Custom companion appearance](custom-appearance.en.md) for the file picker and image requirements.

## Verification

The current mobile matrix is based on upstream documentation and Attune's automated tests. Physical-device checks are pending for the DSH Go native panel and its SSH and relay paths, DSHA's bundled Web UI, and Whaleness on Android and iOS. Those checks include reconnecting, keeping saved preferences after a restart, and seeing the same preferences on two clients attached to one host.
