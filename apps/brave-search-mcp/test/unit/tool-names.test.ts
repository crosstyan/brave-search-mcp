import type { WidgetToolVariant } from '../../src/tool-catalog.js';
import { TOOL_NAMES as aliasToolNames } from '@tool-catalog';
import { describe, expect, it } from 'vitest';
import { ENABLED_TOOL_KEYS, ENABLED_TOOL_NAMES, TOOL_NAMES } from '../../src/tool-catalog.js';

const widgetVariants: WidgetToolVariant[] = ['web', 'image', 'news', 'local', 'video'];

describe('tool catalog', () => {
  it('resolves the alias to the canonical tool catalog', () => {
    expect(aliasToolNames).toEqual(TOOL_NAMES);
  });

  it('maps widget variants directly through the canonical tool catalog', () => {
    expect(widgetVariants.map(variant => TOOL_NAMES[variant])).toEqual([
      TOOL_NAMES.web,
      TOOL_NAMES.image,
      TOOL_NAMES.news,
      TOOL_NAMES.local,
      TOOL_NAMES.video,
    ]);
  });

  it('exposes the full Brave tool list in the canonical enabled tool list', () => {
    expect(ENABLED_TOOL_KEYS).toEqual(['web', 'llmContext', 'image', 'news', 'local', 'video']);
    expect(ENABLED_TOOL_NAMES).toEqual([
      TOOL_NAMES.web,
      TOOL_NAMES.llmContext,
      TOOL_NAMES.image,
      TOOL_NAMES.news,
      TOOL_NAMES.local,
      TOOL_NAMES.video,
    ]);
  });
});
