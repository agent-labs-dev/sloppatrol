// A stand-in for `claude -p`. It connects to the Sloppatrol MCP server in the
// config file given as its first argument and runs the steps in the env var
// FAKE_AGENT_<ROLE> (role = second argument), in order:
//   {"tool": "name", "input": {...}, "mustSucceed": false}
//   {"edit": {"file", "from", "to"}}   edits a file in the working directory
//   {"assess": [{"contains": "text", "score": 3}, {"score": 2}]}   scores every
//     unit an assessor gets: each metric gets the score of the first rule whose
//     `contains` is in the unit's text (a rule without one matches all)
// It prints its result the way `claude -p --output-format json` does.
import { readFileSync, writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const role = process.argv[3];
const queue = process.env[`FAKE_AGENT_${role.toUpperCase()}_QUEUE`];
const steps = queue
  ? JSON.parse(readFileSync(queue, 'utf8'))
  : JSON.parse(process.env[`FAKE_AGENT_${role.toUpperCase()}`] ?? '[]');
/** A queued session consumes its steps, so a session after a timeout resumes the rest. */
const persist = () => {
  if (queue) writeFileSync(queue, JSON.stringify(steps));
};
const client = new Client({ name: 'fake-agent', version: '0.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(config.mcpServers.sloppatrol.url)));
const log = [];
while (steps.length) {
  const step = steps.shift();
  persist();
  if (step.hang) {
    await new Promise((done) => setTimeout(done, step.hang));
    continue;
  }
  if (step.edit) {
    const text = readFileSync(step.edit.file, 'utf8');
    if (!text.includes(step.edit.from)) throw new Error(`fake agent: ${step.edit.from} not in ${step.edit.file}`);
    writeFileSync(step.edit.file, text.replace(step.edit.from, step.edit.to));
    log.push(`edited ${step.edit.file}`);
    continue;
  }
  if (step.assess) {
    const list = (await client.callTool({ name: 'list_units', arguments: {} })).content[0].text;
    for (const [, label, metrics] of list.matchAll(/^- (\S+): .*; score ([\w, ]+)/gm)) {
      const unit = (await client.callTool({ name: 'get_unit', arguments: { label } })).content[0].text;
      const rule = step.assess.find((r) => !r.contains || unit.includes(r.contains));
      const scores = Object.fromEntries(
        metrics.split(', ').map((m) => [m, { score: rule.score, evidence: 'scripted' }]),
      );
      await client.callTool({ name: 'score_unit', arguments: { label, scores } });
    }
    log.push('assessed');
    continue;
  }
  const result = await client.callTool({ name: step.tool, arguments: step.input ?? {} });
  const text = result.content.map((part) => part.text).join('\n');
  log.push(`${step.tool}: ${result.isError ? 'ERROR ' : ''}${text.split('\n')[0]}`);
  if (result.isError && step.mustSucceed !== false) {
    console.log(JSON.stringify({ result: log.join('\n'), is_error: true, total_cost_usd: 0 }));
    process.exit(0);
  }
}
await client.close();
console.log(JSON.stringify({ result: log.join('\n'), total_cost_usd: 0.01 }));
