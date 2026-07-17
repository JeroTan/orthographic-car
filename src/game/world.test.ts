import { describe, expect, it } from 'vitest';

import {
	createCollisionIndex,
	createTerrainIndex,
	generateWorld,
	getRoadsidePosts,
	type WorldLayout,
} from './world';

describe('procedural world', () => {
	function tileKey(world: WorldLayout, x: number, z: number): number {
		const wrappedX = ((x % world.gridSize) + world.gridSize) % world.gridSize;
		const wrappedZ = ((z % world.gridSize) + world.gridSize) % world.gridSize;
		return wrappedZ * world.gridSize + wrappedX;
	}

	function roadTopology(world: WorldLayout) {
		const roads = new Set(world.roads.map((road) => tileKey(world, road.x, road.z)));
		const neighbors = (x: number, z: number) =>
			[
				[x - 1, z],
				[x + 1, z],
				[x, z - 1],
				[x, z + 1],
			].filter(([neighborX, neighborZ]) => roads.has(tileKey(world, neighborX, neighborZ)));
		const visited = new Set<number>();
		const pending = [world.roads[0]];

		while (pending.length > 0) {
			const road = pending.pop();
			if (!road) continue;
			const key = tileKey(world, road.x, road.z);
			if (visited.has(key)) continue;
			visited.add(key);
			for (const [x, z] of neighbors(road.x, road.z)) pending.push({ x, z });
		}

		let roadBlocks = 0;
		for (let z = 0; z < world.gridSize; z += 1) {
			for (let x = 0; x < world.gridSize; x += 1) {
				if (
					[
						[x, z],
						[x + 1, z],
						[x, z + 1],
						[x + 1, z + 1],
					].every(([tileX, tileZ]) => roads.has(tileKey(world, tileX, tileZ)))
				) {
					roadBlocks += 1;
				}
			}
		}

		return {
			connectedRoads: visited.size,
			junctions: world.roads.filter((road) => neighbors(road.x, road.z).length >= 3).length,
			simpleTurns: world.roads.filter((road) => {
				const connected = neighbors(road.x, road.z);
				if (connected.length !== 2) return false;

				const [first, second] = connected;
				return first[0] !== second[0] && first[1] !== second[1];
			}).length,
			roadBlocks,
		};
	}

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

	it('fills meadow with deterministic grass while keeping asphalt clear', () => {
		const world = generateWorld(1337);
		const terrainIndex = createTerrainIndex(world);

		expect(world.grass.length).toBeGreaterThan(500);
		expect(generateWorld(1337).grass).toEqual(world.grass);
		expect(
			world.grass.every((patch) => !terrainIndex.isRoadAt(patch.x, patch.z)),
		).toBe(true);
		expect(
			world.grass.every((patch) => {
				const radius = (patch.kind === 'field' ? 1.4 : 0.9) * patch.scale + 0.25;
				return Array.from({ length: 8 }, (_, index) => (index * Math.PI) / 4).every(
					(angle) =>
						!terrainIndex.isRoadAt(
							patch.x + Math.cos(angle) * radius,
							patch.z + Math.sin(angle) * radius,
						),
				);
			}),
		).toBe(true);
	});

	it('reports vegetation contact only near a grass patch', () => {
		const terrain = createTerrainIndex({
			gridSize: 18,
			tileSize: 8,
			worldSpan: 144,
			roads: [],
			grass: [
				{ kind: 'field', x: 12, z: 10, rotation: 0, scale: 1 },
			],
		});

		expect(terrain.grassDensityAt(12, 10)).toBeGreaterThan(0.8);
		expect(terrain.grassDensityAt(0, 0)).toBe(0);
	});

	it('builds reproducible seed-dependent urban plans without zigzags or asphalt blobs', () => {
		const worlds = [1, 2, 3].map((seed) => generateWorld(seed));
		const signatures = worlds.map((world) =>
			world.roads
				.map((road) => tileKey(world, road.x, road.z))
				.sort((first, second) => first - second)
				.join(','),
		);
		const planChecks = worlds.map((world) => {
			const topology = roadTopology(world);
			const roads = new Set(world.roads.map((road) => tileKey(world, road.x, road.z)));
			const mainCorridorsPresent = Array.from(
				{ length: world.gridSize },
				(_, index) => index,
			).every(
				(index) => roads.has(tileKey(world, index, 9)) && roads.has(tileKey(world, 9, index)),
			);

			return {
				connected: topology.connectedRoads === world.roads.length,
				mainCorridorsPresent,
				hasReadableJunctions: topology.junctions >= 4,
				hasOnlyIntentionalTurns: topology.simpleTurns <= 4,
				hasNoAsphaltBlocks: topology.roadBlocks === 0,
				roadCountIsBounded: world.roads.length >= 40 && world.roads.length <= 80,
			};
		});

		expect({
			repeatable: generateWorld(1).roads,
			uniquePlanCount: new Set(signatures).size,
			planChecks,
		}).toEqual({
			repeatable: worlds[0].roads,
			uniquePlanCount: 3,
			planChecks: Array.from({ length: 3 }, () => ({
				connected: true,
				mainCorridorsPresent: true,
				hasReadableJunctions: true,
				hasOnlyIntentionalTurns: true,
				hasNoAsphaltBlocks: true,
				roadCountIsBounded: true,
			})),
		});
	});

	it('includes roadside lamps in the collision world', () => {
		const world = {
			gridSize: 18,
			tileSize: 8,
			worldSpan: 144,
			roads: [{ x: 9, z: 9 }],
			props: [],
		};

		expect(createCollisionIndex(world).intersectsCircle(8.5, 4, 0.5)).toBe(true);
	});

	it('places roadside lamps outside road tiles', () => {
		const world = {
			gridSize: 18,
			tileSize: 8,
			worldSpan: 144,
			roads: [{ x: 9, z: 9 }],
			props: [],
		};
		const terrainIndex = createTerrainIndex(world);
		const posts = getRoadsidePosts(world);

		expect({
			count: posts.length,
			allOutsideRoad: posts.every((post) => !terrainIndex.isRoadAt(post.x, post.z)),
		}).toEqual({ count: 1, allOutsideRoad: true });
	});
});
