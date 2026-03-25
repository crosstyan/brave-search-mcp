import type { WidgetToolVariant } from '../../src/tool-catalog.js';
import { TOOL_NAMES as aliasToolNames } from '@tool-catalog';
import { describe, expect, it } from 'vitest';
import { ENABLED_TOOL_KEYS, ENABLED_TOOL_NAMES, TOOL_NAMES } from '../../src/tool-catalog.js';

const widgetVariants: WidgetToolVariant[] = ['web'];

describe('tool catalog', () => {
  it('resolves the alias to the canonical tool catalog', () => {
    expect(aliasToolNames).toEqual(TOOL_NAMES);
  });

  it('maps widget variants directly through the canonical tool catalog', () => {
    expect(widgetVariants.map(variant => TOOL_NAMES[variant])).toEqual([TOOL_NAMES.web]);
  });

  it('exposes only the web tool in the enabled tool list', () => {
    expect(ENABLED_TOOL_KEYS).toEqual(['web']);
    expect(ENABLED_TOOL_NAMES).toEqual([TOOL_NAMES.web]);
  });
});
