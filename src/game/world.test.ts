import { describe, expect, it } from 'vitest';

import {
	createCollisionIndex,
	createTerrainIndex,
	generateWorld,
	getRoadsidePosts,
	WORLD_BUILDING_MAX_COUNT,
	WORLD_BUILDING_MIN_COUNT,
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

	it('creates expanded map with roads and scenery', () => {
		const world = generateWorld(1337);

		expect({
			gridSize: world.gridSize,
			tileSize: world.tileSize,
			worldSpan: world.worldSpan,
			hasRoads: world.roads.length > 0,
			hasScenery: world.props.length > 0,
		}).toEqual({
			gridSize: 64,
			tileSize: 8,
			worldSpan: 512,
			hasRoads: true,
			hasScenery: true,
		});
	});

	it('changes scenery when the seed changes', () => {
		const firstWorld = generateWorld(1337);
		const secondWorld = generateWorld(7331);

		expect(secondWorld.props).not.toEqual(firstWorld.props);
	});

	it('fills expanded map with roads, buildings, grass, and props', () => {
		const world = generateWorld(6767);

		expect(world.roads.length).toBeGreaterThanOrEqual(world.gridSize * 4);
		expect(world.buildings.length).toBeGreaterThanOrEqual(WORLD_BUILDING_MIN_COUNT);
		expect(world.grass.length).toBeGreaterThan(4_000);
		expect(world.props.length).toBeGreaterThan(200);
	});

	it('connects local two-lane streets to four-lane arterials', () => {
		const world = generateWorld(6767);
		const roadByKey = new Map(
			world.roads.map((road) => [tileKey(world, road.x, road.z), road] as const),
		);
		const classes = new Set(world.roads.map((road) => road.roadClass));
		const transitions = world.roads.filter((road) =>
			[
				[road.x - 1, road.z],
				[road.x + 1, road.z],
				[road.x, road.z - 1],
				[road.x, road.z + 1],
			].some(
				([x, z]) =>
					roadByKey.get(tileKey(world, x, z))?.roadClass !== undefined &&
					roadByKey.get(tileKey(world, x, z))?.roadClass !== road.roadClass,
			),
		);

		expect(classes).toEqual(new Set(['local', 'arterial']));
		expect(transitions.length).toBeGreaterThan(0);
		expect(world.roads.filter((road) => road.roadClass === 'arterial').length).toBeGreaterThan(
			world.gridSize * 4,
		);
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

	it('places varied buildings beside roads with open lots between them', () => {
		const world = generateWorld(6767);
		const terrain = createTerrainIndex(world);
		const distances = world.buildings.flatMap((building, index) =>
			world.buildings.slice(index + 1).map((other) => {
				const directX = Math.abs(building.x - other.x) % world.worldSpan;
				const directZ = Math.abs(building.z - other.z) % world.worldSpan;
				return Math.hypot(
					Math.min(directX, world.worldSpan - directX),
					Math.min(directZ, world.worldSpan - directZ),
				);
			}),
		);
		const roadProbeDistances = [4, 6, 8, 10];
		const cardinalDirections = [
			{ x: 1, z: 0 },
			{ x: -1, z: 0 },
			{ x: 0, z: 1 },
			{ x: 0, z: -1 },
		];

		expect({
			count: world.buildings.length,
			variantCount: new Set(world.buildings.map((building) => building.variant)).size,
			repeatable: generateWorld(6767).buildings,
			minimumSpacing: Math.min(...distances),
			allNearRoads: world.buildings.every((building) =>
				cardinalDirections.some((direction) =>
					roadProbeDistances.some((distance) =>
						terrain.isRoadAt(
							building.x + direction.x * distance,
							building.z + direction.z * distance,
						),
					),
				),
			),
		}).toEqual({
			count: expect.any(Number),
			variantCount: expect.any(Number),
			repeatable: world.buildings,
			minimumSpacing: expect.any(Number),
			allNearRoads: true,
		});
		expect(world.buildings.length).toBeGreaterThanOrEqual(WORLD_BUILDING_MIN_COUNT);
		expect(world.buildings.length).toBeLessThanOrEqual(WORLD_BUILDING_MAX_COUNT);
		expect(new Set(world.buildings.map((building) => building.variant)).size).toBeGreaterThanOrEqual(4);
		expect(Math.min(...distances)).toBeGreaterThanOrEqual(6.5);
		expect(Math.min(...distances)).toBeLessThan(9);
	});

	it('keeps different generated plans densely built', () => {
		const buildingCounts = [1, 2, 3, 1337, 6767].map(
			(seed) => generateWorld(seed).buildings.length,
		);

		expect(
			buildingCounts.every(
				(count) => count >= WORLD_BUILDING_MIN_COUNT && count <= WORLD_BUILDING_MAX_COUNT,
			),
		).toBe(true);
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
				(index) => {
					const anchor = world.gridSize / 2;
					return (
						roads.has(tileKey(world, index, anchor)) &&
						roads.has(tileKey(world, anchor, index))
					);
				},
			);

			return {
				connected: topology.connectedRoads === world.roads.length,
				mainCorridorsPresent,
				hasReadableJunctions: topology.junctions >= 12,
				hasOnlyIntentionalTurns: topology.simpleTurns <= 4,
				hasNoAsphaltBlocks: topology.roadBlocks === 0,
				roadCountIsBounded:
					world.roads.length >= world.gridSize * 4 &&
					world.roads.length <= world.gridSize * 8,
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

	it('does not add roadside lamps to the collision world', () => {
		const world = {
			gridSize: 18,
			tileSize: 8,
			worldSpan: 144,
			roads: [{ x: 9, z: 9 }],
			props: [],
		};

		expect(createCollisionIndex(world).intersectsCircle(8.5, 4, 0.5)).toBe(false);
	});

	it('treats residential buildings as solid scenery', () => {
		const world = generateWorld(6767);
		const building = world.buildings[0];

		expect(createCollisionIndex(world).intersectsCircle(building.x, building.z, 0.5)).toBe(
			true,
		);
	});

	it('does not generate roadside lamps', () => {
		const world = {
			gridSize: 18,
			tileSize: 8,
			worldSpan: 144,
			roads: [{ x: 9, z: 9 }],
			props: [],
		};

		expect(getRoadsidePosts(world)).toEqual([]);
	});
});
