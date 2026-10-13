import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { z } from 'zod';
import { actSchemaFor, TOOL_SCHEMAS, toolSchemasFor } from '../../src/mcp/contracts.ts';
import { validateWorld } from '../../src/world/index.ts';
import { v2World } from '../support/world-v2.ts';

const flow = validateWorld(JSON.parse(readFileSync(new URL('../../examples/worlds/flow-diagram/world.json', import.meta.url), 'utf8')));
const input = (name: string, params: Record<string, unknown>) => ({ name, params, baseStep: 0, expectedRevision: 0 });

describe('MCP act schema generated from the session world', () => {
  it('a world/1 session offers exactly its seven actions with their parameter objects', () => {
    const schema = actSchemaFor(flow.actions);
    const json = z.toJSONSchema(schema as z.ZodType, { io: 'input' }) as unknown as { type: string; properties: { name: { enum: string[] } } };
    assert.equal(json.type, 'object');
    assert.deepEqual(json.properties.name.enum, flow.actions.map(a => a.name));
    assert.equal(schema.safeParse(input('rename_step', { id: 'a', label: 'X' })).success, true);
    assert.equal(schema.safeParse(input('set_style', { id: 'a', shape: 'diamond', stroke: 'red', fill: 'none' })).success, false);
    // Parameters belong to their action: rename_step with move_step's parameters is refused.
    assert.equal(schema.safeParse(input('rename_step', { id: 'a', x: 1, y: 2 })).success, false);
  });
  it('a world/2 session offers the new actions, enum values and nullable frame ids', () => {
    const schema = actSchemaFor(v2World().actions);
    assert.equal(schema.safeParse(input('set_style', { id: 'a', shape: 'diamond', stroke: 'red', fill: 'yellow' })).success, true);
    assert.equal(schema.safeParse(input('set_style', { id: 'a', shape: 'hexagon', stroke: 'red', fill: 'yellow' })).success, false);
    assert.equal(schema.safeParse(input('add_step', { frameId: null, label: 'A', x: 0, y: 0, width: 100, height: 60, shape: 'ellipse' })).success, true);
    assert.equal(schema.safeParse(input('add_step', { frameId: null, label: 'A', x: 0, y: 0, width: 100, height: 60, fontFamily: 3 })).success, false);
  });
  it('without a world the generic vocabulary stays and other tools are untouched', () => {
    const schemas = toolSchemasFor(undefined);
    assert.equal(schemas.act, TOOL_SCHEMAS.act);
    assert.equal(toolSchemasFor(flow.actions).observe, TOOL_SCHEMAS.observe);
  });
});
