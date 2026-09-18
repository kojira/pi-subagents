import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { finalizePublicToolResult, finalizeToolResult } from "../../src/extension/tool-result.ts";

const asyncResult = () => ({
	content: [{ type: "text" as const, text: "Async run started" }],
	details: { asyncId: "run-1" },
});

describe("registered subagent tool results", () => {
	it("terminates the parent batch after a successful public async launch", () => {
		const result = finalizePublicToolResult({}, asyncResult());
		assert.equal(result.terminate, true);
		assert.equal(result.park, true);
		assert.equal(result.details.asyncId, "run-1");
	});

	it("does not terminate management calls that reference an async run", () => {
		const result = finalizePublicToolResult({ action: "status" }, asyncResult());
		assert.equal(result.terminate, undefined);
		assert.equal(result.park, undefined);
	});

	it("does not terminate a public result without an active async run", () => {
		const result = finalizePublicToolResult({}, {
			content: [{ type: "text", text: "Completed" }],
			details: {},
		});
		assert.equal(result.terminate, undefined);
		assert.equal(result.park, undefined);
	});

	it("preserves canonical rejection for logical errors", () => {
		assert.throws(
			() => finalizeToolResult({
				content: [{ type: "text", text: "Launch rejected" }],
				isError: true,
				details: {},
			}),
			/Launch rejected/,
		);
	});
});
