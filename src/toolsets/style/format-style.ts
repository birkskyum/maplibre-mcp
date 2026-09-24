import {format, migrate} from '@maplibre/maplibre-gl-style-spec';
import type {McpServer} from '@modelcontextprotocol/server';
import {z} from 'zod';
import {loadStyle, returnStyle, STYLE_INPUT} from '../../style-input.js';

export function registerFormatStyle(server: McpServer): void {
    server.registerTool('format_style', {
        title: 'Format style',
        description: [
            'Formats a MapLibre style with the keys in the order of the style specification and two space indentation,',
            'the same way as gl-style-format. A style given as a file path is formatted in place,',
            'otherwise the formatted JSON is returned.',
        ].join(' '),
        inputSchema: z.object(STYLE_INPUT),
        annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true},
    }, async input => {
        const style = await loadStyle(input);
        return returnStyle(input, `${format(style, 2)}\n`, 'Formatted');
    });
}

export function registerMigrateStyle(server: McpServer): void {
    server.registerTool('migrate_style', {
        title: 'Migrate style',
        description: [
            'Migrates an old style to the current MapLibre Style Specification, the same way as gl-style-migrate:',
            'version 7 styles become version 8, and legacy functions and filters become expressions.',
            'A style given as a file path is migrated in place, otherwise the migrated JSON is returned.',
        ].join(' '),
        inputSchema: z.object(STYLE_INPUT),
        annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true},
    }, async input => {
        const style = await loadStyle(input);
        return returnStyle(input, `${format(migrate(style), 2)}\n`, 'Migrated');
    });
}
