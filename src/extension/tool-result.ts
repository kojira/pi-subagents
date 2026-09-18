import type { AgentToolResult } from "@earendil-works/pi-agent-core";

/**
 * Convert pi-subagents' internal logical-error result into the rejection Pi's
 * public tool boundary uses to emit a canonical errored ToolResult.
 *
 * Keep this at registered tool boundaries. Internal workflows intentionally
 * retain their return-based error handling.
 */
export function finalizeToolResult<T>(result: AgentToolResult<T>): AgentToolResult<T> {
	if (result.isError !== true) return result;

	const message = result.content
		.flatMap((item) => item.type === "text" && typeof item.text === "string" ? [item.text] : [])
		.join("\n")
		.trim();

	throw new Error(message || "pi-subagents reported a logical tool failure.");
}

/**
 * Public async launches are completion-notified. End the parent tool batch so
 * the host can park until that native notification instead of polling the run.
 * Management calls remain ordinary tool boundaries even when their details
 * mention an async run.
 */
export function finalizePublicToolResult<T extends { asyncId?: string }>(
	params: { action?: unknown },
	result: AgentToolResult<T>,
): AgentToolResult<T> & { park?: boolean } {
	const finalized = finalizeToolResult(result);
	if (params.action === undefined && finalized.details.asyncId) {
		return { ...finalized, terminate: true, park: true };
	}
	return finalized;
}
