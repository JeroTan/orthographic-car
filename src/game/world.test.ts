import { describe, expect, it } from 'vitest';

import {
	createCollisionIndex,
	createRoadIndex,
	generateWorld,
	getRoadsidePosts,
	type WorldLayout,
} from './world';

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

	it('includes roadside lamps in the collision world', () => {
		const world: WorldLayout = {
			gridSize: 18,
			tileSize: 8,
			worldSpan: 144,
			roads: [{ x: 9, z: 9 }],
			props: [],
		};

		expect(createCollisionIndex(world).intersectsCircle(8.5, 4, 0.5)).toBe(true);
	});

	it('places roadside lamps outside road tiles', () => {
		const world: WorldLayout = {
			gridSize: 18,
			tileSize: 8,
			worldSpan: 144,
			roads: [{ x: 9, z: 9 }],
			props: [],
		};
		const roadIndex = createRoadIndex(world);
		const posts = getRoadsidePosts(world);

		expect({
			count: posts.length,
			allOutsideRoad: posts.every((post) => !roadIndex.hasWorldPosition(post.x, post.z)),
		}).toEqual({ count: 1, allOutsideRoad: true });
	});
});
