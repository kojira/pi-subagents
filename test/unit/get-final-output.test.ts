import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Message } from "@earendil-works/pi-ai";
import { detectSubagentError, getFinalOutput } from "../../src/shared/utils.ts";

function assistantContent(content: unknown[]): Message {
	return { role: "assistant", content } as unknown as Message;
}

function finishWorkMessages(summary: string, options: { isError?: boolean; includeResult?: boolean } = {}): Message[] {
	const id = "finish-1";
	const messages: Message[] = [assistantContent([{
		type: "toolCall",
		id,
		name: "finish_work",
		arguments: { checkpointId: "work-1", outcome: "completed", reason: "done", summary },
	}])];
	if (options.includeResult !== false) {
		messages.push({
			role: "toolResult",
			toolCallId: id,
			toolName: "finish_work",
			content: [{ type: "text", text: options.isError ? "finish failed" : "ok" }],
			isError: options.isError ?? false,
			timestamp: 0,
		} as Message);
	}
	return messages;
}

describe("getFinalOutput", () => {
	it("uses the last non-empty text part in the latest assistant message", () => {
		const messages = [assistantContent([
			{ type: "text", text: "" },
			{ type: "text", text: "Summary" },
		])];

		assert.equal(getFinalOutput(messages), "Summary");
	});

	it("removes a trailing Pi turn-timing footer from final output", () => {
		const report = "## Review\n\nVERDICT: FINDINGS";
		const timingFooter = "\x1b[38;2;136;136;136m✻ Turn took 5m 54s (Total time 5m 54s · 2 turns)\x1b[0m";
		const messages = [assistantContent([
			{ type: "text", text: `${report}\n\n${timingFooter}` },
		])];

		assert.equal(getFinalOutput(messages), report);
	});

	it("ignores a separate Pi turn-timing footer text part", () => {
		const report = "## Review\n\nVERDICT: CLEAN";
		const timingFooter = "\x1b[38;2;136;136;136m✻ Turn took 2m 19s (Total time 2m 18s · 1 turn)\x1b[0m";
		const messages = [assistantContent([
			{ type: "text", text: report },
			{ type: "text", text: timingFooter },
		])];

		assert.equal(getFinalOutput(messages), report);
	});

	it("preserves ordinary timing prose", () => {
		const text = "The benchmark turn took 5m 54s.";
		assert.equal(getFinalOutput([assistantContent([{ type: "text", text }])]), text);
	});

	it("prefers final text over progress text in a multi-part assistant message", () => {
		const messages = [assistantContent([
			{ type: "text", text: "Working on the fix..." },
			{ type: "thinking", thinking: "Cursor shell: shell $ npm test" },
			{ type: "text", text: "Implemented: patch applied." },
		])];

		assert.equal(getFinalOutput(messages), "Implemented: patch applied.");
	});

	it("falls back to an older assistant message when the latest text is whitespace-only", () => {
		const messages = [
			assistantContent([{ type: "text", text: "Earlier" }]),
			assistantContent([{ type: "text", text: " \n\t " }]),
		];

		assert.equal(getFinalOutput(messages), "Earlier");
	});

	it("falls back to an older assistant message when the latest assistant message is tool-only", () => {
		const messages = [
			assistantContent([{ type: "text", text: "Earlier" }]),
			assistantContent([{ type: "toolCall", name: "read", arguments: { path: "README.md" } }]),
		];

		assert.equal(getFinalOutput(messages), "Earlier");
	});

	it("uses a successfully completed finish_work summary as final output", () => {
		assert.equal(getFinalOutput(finishWorkMessages("Completed review.")), "Completed review.");
	});

	it("does not use finish_work arguments without a successful matching result", () => {
		assert.equal(getFinalOutput(finishWorkMessages("Uncommitted.", { includeResult: false })), "");
		assert.equal(getFinalOutput(finishWorkMessages("Rejected.", { isError: true })), "");
	});

	it("treats a successful finish_work as the boundary for earlier tool errors", () => {
		const messages = [
			assistantContent([{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "missing" } }]),
			{
				role: "toolResult",
				toolCallId: "read-1",
				toolName: "read",
				content: [{ type: "text", text: "not found" }],
				isError: true,
				timestamp: 0,
			} as Message,
			...finishWorkMessages("Recovered and completed."),
		];

		assert.deepEqual(detectSubagentError(messages), { hasError: false });
		assert.equal(getFinalOutput(messages), "Recovered and completed.");
	});

	it("prefers an earlier explicit acceptance report over later summary-only text", () => {
		const report = [
			"Done",
			"```acceptance-report",
			JSON.stringify({
				criteriaSatisfied: [{ id: "criterion-1", status: "satisfied", evidence: "verified" }],
				changedFiles: ["src/file.ts"],
			}),
			"```",
		].join("\n");
		const messages = [
			assistantContent([{ type: "text", text: report }]),
			assistantContent([{ type: "text", text: "Done." }]),
		];

		assert.equal(getFinalOutput(messages), report);
	});

	it("prefers an earlier json-fenced acceptance report over later summary-only text", () => {
		const report = [
			"Done",
			"```json",
			JSON.stringify({
				criteriaSatisfied: [{ id: "criterion-1", status: "satisfied", evidence: "verified" }],
				validationOutput: ["tests passed"],
			}),
			"```",
		].join("\n");
		const messages = [
			assistantContent([{ type: "text", text: report }]),
			assistantContent([{ type: "text", text: "Done." }]),
		];

		assert.equal(getFinalOutput(messages), report);
	});

	it("preserves prose from a sibling text part when selecting an acceptance report", () => {
		const report = "```acceptance-report\n{}\n```";
		const messages = [assistantContent([
			{ type: "text", text: "Human-readable answer." },
			{ type: "text", text: report },
		])];

		assert.equal(getFinalOutput(messages), `Human-readable answer.\n${report}`);
	});

	it("recognizes underscore fences and snake_case generic report keys", () => {
		for (const report of [
			"```acceptance_report\n{}\n```",
			`\`\`\`json\n${JSON.stringify({ criteria_satisfied: [], validation_output: ["passed"] })}\n\`\`\``,
		]) {
			const messages = [
				assistantContent([{ type: "text", text: report }]),
				assistantContent([{ type: "text", text: "Later summary." }]),
			];
			assert.equal(getFinalOutput(messages), report);
		}
	});

	it("does not prefer provider-error acceptance reports", () => {
		const messages = [
			{
				role: "assistant",
				content: [{ type: "text", text: "```acceptance-report\n{}\n```" }],
				stopReason: "error",
				errorMessage: "provider transport failed",
			} as unknown as Message,
			assistantContent([{ type: "text", text: "Done." }]),
		];

		assert.equal(getFinalOutput(messages), "Done.");
	});

	it("returns empty output when all assistant text is empty or whitespace-only", () => {
		const messages = [
			assistantContent([{ type: "text", text: "" }]),
			assistantContent([{ type: "text", text: "\n\t " }]),
		];

		assert.equal(getFinalOutput(messages), "");
	});

	it("does not use provider-error assistant text as fallback output", () => {
		const messages = [
			{
				role: "assistant",
				content: [{ type: "text", text: "temporary provider failure" }],
				stopReason: "error",
				errorMessage: "provider transport failed",
			} as unknown as Message,
			assistantContent([{ type: "text", text: "" }]),
		];

		assert.equal(getFinalOutput(messages), "");
	});

	it("preserves surrounding whitespace on the selected non-empty text", () => {
		const messages = [assistantContent([{ type: "text", text: " \n Summary \n " }])];

		assert.equal(getFinalOutput(messages), " \n Summary \n ");
	});
});
