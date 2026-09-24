import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import type {McpServer} from '@modelcontextprotocol/server';
import {z} from 'zod';
import {loadStyle, STYLE_INPUT} from '../../style-input.js';

export function registerValidateStyle(server: McpServer): void {
    server.registerTool('validate_style', {
        title: 'Validate style',
        description: [
            'Checks a MapLibre style against the MapLibre Style Specification and lists every problem,',
            'each with the path to the property it is about. Run it after editing a style.',
            'Pass the style as an object, a URL or a file path.',
        ].join(' '),
        inputSchema: z.object(STYLE_INPUT),
        outputSchema: z.object({
            problems: z.array(z.object({severity: z.enum(['error', 'warning']), message: z.string()})),
        }),
        annotations: {readOnlyHint: true, openWorldHint: true},
    }, async input => {
        const style = await loadStyle(input);
        const problems = validateStyleMin(style).map(({severity, message}) => ({severity, message}));
        const text = problems.length === 0 ?
            'The style is valid.' :
            problems.map(({severity, message}) => `${severity}: ${message}`).join('\n');
        return {content: [{type: 'text', text}], structuredContent: {problems}};
    });
}
