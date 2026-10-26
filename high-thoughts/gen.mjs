import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { writeFileSync } from "node:fs";
import { streamPrototype } from "./src/prototype.ts";
const [out, kind, thought, ...qa] = process.argv.slice(2);
const answers = [];
for (let i = 0; i < qa.length; i += 2) answers.push({ question: qa[i], answer: qa[i + 1] });
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
let html = "";
for await (const e of streamPrototype({ client, model: "claude-opus-5", thought, answers, kind })) {
  if (e.type === "text") html += e.text;
  if (e.type === "error") { console.error("ERR", e.message); process.exit(1); }
  if (e.type === "done") console.error(`${out}: ${e.inputTokens} in / ${e.outputTokens} out`);
}
writeFileSync(out, html.replace(/^```html?\s*/, "").replace(/```\s*$/, "").trim());
