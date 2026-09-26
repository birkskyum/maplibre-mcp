import {afterEach, describe, expect, test, vi} from 'vitest';
import {connect, textOf} from './connect.js';

/** Type definitions in the shape GL JS 5 ships: `Map` gets its camera methods from a class it doesn't export. */
const OLDER_TYPES = `
declare abstract class Camera {
  /**
   * Flies to a place.
   * @param options - Where to fly.
   */
  flyTo(options: object): this;
}
declare class Map$1 extends Camera {
  /** @internal */
  _render(): void;
}
export { Map$1 as Map };
`;

async function lookUp(name: string, version?: string): Promise<string> {
    const client = await connect('gl-js');
    return textOf(await client.callTool({name: 'describe_gl_js_api', arguments: {name, ...version ? {version} : {}}}));
}

describe('describe_gl_js_api', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    test('describes a method with its signature, parameters, example and docs page', async () => {
        const text = await lookUp('Map#flyTo');
        expect(text).toMatch(/^Map#flyTo \(method of Map, MapLibre GL JS \d+\.\d+\.\d+\)\nflyTo\(options: FlyToOptions, eventData\?: any\): this\n/);
        expect(text).toContain('Parameters:\n  options: Options describing the destination and animation of the transition.');
        expect(text).toContain('map.flyTo({center: [0, 0], zoom: 9});');
        expect(text).toContain('Docs: https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/#flyto');
    });

    test('finds an option by its name alone, with its default', async () => {
        const text = await lookUp('maxPitch');
        expect(text).toContain('MapOptions.maxPitch (property of MapOptions, MapLibre GL JS');
        expect(text).toContain('maxPitch?: number | null\nThe maximum pitch of the map (0-180).\nDefault: 60');
    });

    test('lists the options of a type, and the types it takes more options from', async () => {
        const text = await lookUp('FlyToOptions');
        expect(text).toContain('Properties:\n  curve?: number (default 1.42). The zooming "curve" that will occur along the flight path.');
        expect(text).toContain('From AnimationOptions: duration, easing, offset, animate, essential');
    });

    test('lists every member that has a name, when several have it', async () => {
        const text = await lookUp('click');
        expect(text).toContain('  MapEventType.click: Fired when a pointing device (usually a mouse) is pressed and released at the same point on the map.');
        expect(text).toContain('  MarkerEventType.click: Fired when the marker is clicked.');
    });

    test('shows the documentation that a member inherits', async () => {
        const text = await lookUp('NavigationControl#onAdd');
        expect(text).toContain('Register a control on the map and give it a chance to register event listeners');
    });

    test('suggests the closest members for a misspelled one', async () => {
        const text = await lookUp('Map#setPaintProperties');
        expect(text).toMatch(/^Map has no member "setPaintProperties" in MapLibre GL JS [\d.]+\. Did you mean: setPaintProperty/);
    });

    test('says when a method is not in MapLibre GL JS', async () => {
        const text = await lookUp('setFog');
        expect(text).toMatch(/^"setFog" is not in MapLibre GL JS [\d.]+\.$/);
    });

    test('reads the type definitions of another version from jsDelivr', async () => {
        const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(OLDER_TYPES, {headers: {'x-jsd-version': '5.9.0'}}));
        const text = await lookUp('flyTo', '5.9');
        expect(fetch).toHaveBeenCalledWith('https://cdn.jsdelivr.net/npm/maplibre-gl@5.9/dist/maplibre-gl.d.ts');
        expect(text).toContain('Map#flyTo (method of Map, from Camera, MapLibre GL JS 5.9.0)\nflyTo(options: object): this\nFlies to a place.');
        expect(await lookUp('Map#_render', '5.9')).toBe('Map has no member "_render" in MapLibre GL JS 5.9.0.');
    });
});
