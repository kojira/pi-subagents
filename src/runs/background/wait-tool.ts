import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { SubagentWaitParams } from "../../extension/schemas.ts";
import type { Details, SubagentState } from "../../shared/types.ts";
import { resolveWaitToolConfig, waitForSubagents } from "./subagent-wait.ts";
import type { WaitSubscriptionManager } from "./wait-subscriptions.ts";
import { finalizeToolResult } from "../../extension/tool-result.ts";

export function registerWaitTool(
	pi: ExtensionAPI,
	state: SubagentState,
	enabled = resolveWaitToolConfig().enabled,
	subscriptions?: Pick<WaitSubscriptionManager, "arm">,
	defaultTimeoutMs?: number,
): void {
	const description = `Register a completion wake for background work without native notifications and return immediately. This tool never waits for work to finish. Ordinary async subagents already notify the parent: return control instead of calling bg_wait. Supply id for provider or detached work requiring an explicit subscription. The parent is woken on completion, failure, attention, or timeout. A long-lived interactive/RPC runtime is required; no blocking fallback exists.${enabled ? "" : " Subscriptions are disabled by configuration."}`;
	const execute: ToolDefinition<typeof SubagentWaitParams, Details>["execute"] = async (_id, params, signal, onUpdate, ctx) => finalizeToolResult(await waitForSubagents({ id: params.id, timeoutMs: params.timeoutMs, nonBlocking: true }, signal, {
		state,
		events: pi.events,
		enabled,
		...(defaultTimeoutMs !== undefined ? { defaultTimeoutMs } : {}),
		onUpdate,
		...(subscriptions && ctx?.hasUI ? { subscribe: (input) => subscriptions.arm(input) } : {}),
	}));
	const primaryTool: ToolDefinition<typeof SubagentWaitParams, Details> = {
		name: "bg_wait",
		label: "Background Wait",
		description,
		parameters: SubagentWaitParams,
		execute,
	};
	pi.registerTool(primaryTool);
}
