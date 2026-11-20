/** Model-visible names and guidance of the secret-guard plugin. */

/** MCP server name; fixes the `mcp__secret_guard__` tool namespace. */
export const SERVER_NAME = 'secret_guard'

/** Model-visible guidance while the plugin is loaded. */
export const GUIDANCE = 'The user\'s credentials are managed by AgentSecret, and the user approves each use on their approver. '
  + 'Text that held a credential reaches you with `{{secretref:<alias>}}` in its place. '
  + 'To put a credential into a file, call `secret_write_file` with the reference in `content`; the file receives the real value after approval. '
  + 'Use the `mcp__secret_guard__*` tools for operations AgentSecret performs itself. Never ask the user to paste a credential into the conversation.'
