import { describe, expect, it } from 'vitest';

import { generateWorld } from './world';

describe('procedural world', () => {
	it('creates a small map with roads and scenery', () => {
		const world = generateWorld(1337);

		expect({
			gridSize: world.gridSize,
			tileSize: world.tileSize,
			worldSpan: world.worldSpan,
			hasRoads: world.roads.length > 0,
			hasScenery: world.props.length > 0,
		}).toEqual({
			gridSize: 18,
			tileSize: 8,
			worldSpan: 144,
			hasRoads: true,
			hasScenery: true,
		});
	});

	it('changes scenery when the seed changes', () => {
		const firstWorld = generateWorld(1337);
		const secondWorld = generateWorld(7331);

		expect(secondWorld.props).not.toEqual(firstWorld.props);
	});

	it('changes its looping road layout when the seed changes', () => {
		const firstWorld = generateWorld(1337);
		const secondWorld = generateWorld(7331);

		expect(secondWorld.roads).not.toEqual(firstWorld.roads);
	});
});
