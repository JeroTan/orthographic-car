import { createRoadSurfaceQuery } from './road-surface';

export const WORLD_GRID_SIZE = 18;
export const WORLD_TILE_SIZE = 8;
export const WORLD_SPAN = WORLD_GRID_SIZE * WORLD_TILE_SIZE;
export const REPEATED_WORLD_OFFSETS = [-1, 0, 1] as const;

export interface TileCoordinate {
	x: number;
	z: number;
}

export type PropKind = 'tree' | 'rock' | 'flowers' | 'cottage';

interface TransformPlacement {
	x: number;
	z: number;
	rotation: number;
	scale: number;
}

export interface PropPlacement extends TransformPlacement {
	kind: PropKind;
}

export type GrassKind = 'field' | 'wild';

export interface GrassPlacement extends TransformPlacement {
	kind: GrassKind;
}

export type BuildingVariant = 0 | 1 | 2 | 3 | 4 | 5;

export interface BuildingPlacement extends TransformPlacement {
	variant: BuildingVariant;
}

export interface RoadLayout {
	gridSize: number;
	tileSize: number;
	worldSpan: number;
	roads: TileCoordinate[];
}

export interface WorldLayout extends RoadLayout {
	props: PropPlacement[];
	grass: GrassPlacement[];
	buildings: BuildingPlacement[];
}

export interface TerrainIndex {
	isRoadAt(x: number, z: number): boolean;
	surfaceAt(x: number, z: number): 'road' | 'meadow';
	grassDensityAt(x: number, z: number): number;
}

export interface CollisionIndex {
	intersectsCircle(x: number, z: number, radius: number): boolean;
}

function wrappedDistance(a: number, b: number, span: number) {
	const direct = Math.abs(a - b) % span;
	return Math.min(direct, span - direct);
}

function wrapWorldCoordinate(value: number, span: number) {
	const halfSpan = span / 2;
	return ((((value + halfSpan) % span) + span) % span) - halfSpan;
}

export interface WorldPoint {
	x: number;
	z: number;
}

function createRandom(seed: number): () => number {
	let state = seed >>> 0;

	return () => {
		state += 0x6d2b79f5;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
	};
}

function tileId(x: number, z: number): number {
	return z * WORLD_GRID_SIZE + x;
}

function tileToWorld(index: number): number {
	return (index + 0.5) * WORLD_TILE_SIZE - WORLD_SPAN / 2;
}

function wrapTile(index: number): number {
	return ((index % WORLD_GRID_SIZE) + WORLD_GRID_SIZE) % WORLD_GRID_SIZE;
}

function addRoadTile(roadTiles: Set<number>, x: number, z: number): void {
	roadTiles.add(tileId(wrapTile(x), wrapTile(z)));
}

function addHorizontalRoad(roadTiles: Set<number>, z: number, startX: number, endX: number): void {
	for (let x = startX; x <= endX; x += 1) addRoadTile(roadTiles, x, z);
}

function addVerticalRoad(roadTiles: Set<number>, x: number, startZ: number, endZ: number): void {
	for (let z = startZ; z <= endZ; z += 1) addRoadTile(roadTiles, x, z);
}

function randomInteger(random: () => number, minimum: number, maximum: number): number {
	return minimum + Math.floor(random() * (maximum - minimum + 1));
}

function addCollectorLoop(roadTiles: Set<number>, random: () => number): void {
	const west = randomInteger(random, 3, 5);
	const east = randomInteger(random, 12, 14);
	const north = randomInteger(random, 3, 5);
	const south = randomInteger(random, 12, 14);

	addHorizontalRoad(roadTiles, north, west, east);
	addHorizontalRoad(roadTiles, south, west, east);
	addVerticalRoad(roadTiles, west, north, south);
	addVerticalRoad(roadTiles, east, north, south);
}

function randomOuterRoad(random: () => number): number {
	return random() < 0.5 ? randomInteger(random, 3, 6) : randomInteger(random, 11, 14);
}

function addParallelGrid(roadTiles: Set<number>, random: () => number): void {
	addHorizontalRoad(roadTiles, randomOuterRoad(random), 0, WORLD_GRID_SIZE - 1);
	addVerticalRoad(roadTiles, randomOuterRoad(random), 0, WORLD_GRID_SIZE - 1);
}

function addCornerBlock(roadTiles: Set<number>, outerX: number, outerZ: number): void {
	const anchor = WORLD_GRID_SIZE / 2;
	addHorizontalRoad(roadTiles, outerZ, Math.min(outerX, anchor), Math.max(outerX, anchor));
	addVerticalRoad(roadTiles, outerX, Math.min(outerZ, anchor), Math.max(outerZ, anchor));
}

function addStaggeredBlocks(roadTiles: Set<number>, random: () => number): void {
	const west = randomInteger(random, 3, 6);
	const east = randomInteger(random, 11, 14);
	const north = randomInteger(random, 3, 6);
	const south = randomInteger(random, 11, 14);

	if (random() < 0.5) {
		addCornerBlock(roadTiles, west, north);
		addCornerBlock(roadTiles, east, south);
	} else {
		addCornerBlock(roadTiles, east, north);
		addCornerBlock(roadTiles, west, south);
	}
}

function grassPatchRadius(kind: GrassKind, scale: number): number {
	return (kind === 'field' ? 1.4 : 0.9) * scale;
}

function wrappedPointDistance(
	first: WorldPoint,
	second: WorldPoint,
	worldSpan: number,
): number {
	return Math.hypot(
		wrappedDistance(first.x, second.x, worldSpan),
		wrappedDistance(first.z, second.z, worldSpan),
	);
}

function isNearBuilding(
	buildings: readonly BuildingPlacement[],
	point: WorldPoint,
	clearance: number,
): boolean {
	return buildings.some(
		(building) => wrappedPointDistance(building, point, WORLD_SPAN) < clearance,
	);
}

function generateBuildings(roadTiles: ReadonlySet<number>, seed: number): BuildingPlacement[] {
	const random = createRandom(seed ^ 0x51ed270b);
	const spacing = [10, 14, 18][Math.floor(random() * 3)];
	const variantOffset = Math.floor(random() * 6);
	const buildings: BuildingPlacement[] = [];
	const candidates: Array<BuildingPlacement & { roll: number }> = [];
	const neighborDirections = [
		{ x: 1, z: 0 },
		{ x: -1, z: 0 },
		{ x: 0, z: 1 },
		{ x: 0, z: -1 },
	] as const;

	for (let z = 0; z < WORLD_GRID_SIZE; z += 1) {
		for (let x = 0; x < WORLD_GRID_SIZE; x += 1) {
			if (roadTiles.has(tileId(x, z))) continue;
			const roadDirection = neighborDirections.find((direction) =>
				roadTiles.has(tileId(wrapTile(x + direction.x), wrapTile(z + direction.z))),
			);
			if (!roadDirection) continue;

			candidates.push({
				variant: 0,
				x: tileToWorld(x) - roadDirection.x * 0.55,
				z: tileToWorld(z) - roadDirection.z * 0.55,
				rotation: roadDirection.x !== 0 ? 0 : Math.PI / 2,
				scale: 0.9 + random() * 0.18,
				roll: random(),
			});
		}
	}

	function place(candidate: BuildingPlacement & { roll: number }): void {
		if (buildings.length >= 16 || isNearBuilding(buildings, candidate, spacing)) return;
		buildings.push({
			variant: ((variantOffset + buildings.length) % 6) as BuildingVariant,
			x: candidate.x,
			z: candidate.z,
			rotation: candidate.rotation,
			scale: candidate.scale,
		});
	}

	for (const candidate of candidates) {
		if (candidate.roll < 0.58) place(candidate);
	}
	if (buildings.length < 6) {
		for (const candidate of candidates) place(candidate);
	}
	return buildings;
}

export function generateWorld(seed: number): WorldLayout {
	const random = createRandom(seed);
	const roadRandom = createRandom(seed ^ 0x9e3779b9);
	const roadTiles = new Set<number>();
	const anchor = WORLD_GRID_SIZE / 2;

	// Every family starts from straight seam-wrapping arterials. Seeded grammar
	// adds only whole orthogonal segments, preventing noisy staircase roads.
	addHorizontalRoad(roadTiles, anchor, 0, WORLD_GRID_SIZE - 1);
	addVerticalRoad(roadTiles, anchor, 0, WORLD_GRID_SIZE - 1);

	const roadFamily = Math.floor(roadRandom() * 3);
	if (roadFamily === 0) addCollectorLoop(roadTiles, roadRandom);
	else if (roadFamily === 1) addParallelGrid(roadTiles, roadRandom);
	else addStaggeredBlocks(roadTiles, roadRandom);

	const roads = [...roadTiles].map((id) => {
		return { x: id % WORLD_GRID_SIZE, z: Math.floor(id / WORLD_GRID_SIZE) };
	});
	const buildings = generateBuildings(roadTiles, seed);
	const grassRandom = createRandom(seed ^ 0x7f4a7c15);
	const grass: GrassPlacement[] = [];
	const roadSurface = createRoadSurfaceQuery({
		gridSize: WORLD_GRID_SIZE,
		tileSize: WORLD_TILE_SIZE,
		worldSpan: WORLD_SPAN,
		roads,
	});
	for (let z = 0; z < WORLD_GRID_SIZE; z += 1) {
		for (let x = 0; x < WORLD_GRID_SIZE; x += 1) {
			if (roadTiles.has(tileId(x, z))) continue;

			for (let patch = 0; patch < 4; patch += 1) {
				const grassX = tileToWorld(x) + (grassRandom() - 0.5) * WORLD_TILE_SIZE * 0.84;
				const grassZ = tileToWorld(z) + (grassRandom() - 0.5) * WORLD_TILE_SIZE * 0.84;
				if (isNearBuilding(buildings, { x: grassX, z: grassZ }, 4)) continue;
				const kind: GrassKind = grassRandom() < 0.14 ? 'wild' : 'field';
				const scale = 0.72 + grassRandom() * 0.58;
				const clearance = grassPatchRadius(kind, scale) + 0.25;
				const overlapsRoad = Array.from(
					{ length: 8 },
					(_, index) => (index * Math.PI) / 4,
				).some((angle) =>
					roadSurface.containsPoint(
						grassX + Math.cos(angle) * clearance,
						grassZ + Math.sin(angle) * clearance,
					),
				);
				if (roadSurface.containsPoint(grassX, grassZ) || overlapsRoad) continue;
				grass.push({
					kind,
					x: grassX,
					z: grassZ,
					rotation: grassRandom() * Math.PI * 2,
					scale,
				});
			}
		}
	}
	const props: PropPlacement[] = [];

	for (let z = 0; z < WORLD_GRID_SIZE; z += 1) {
		for (let x = 0; x < WORLD_GRID_SIZE; x += 1) {
			if (roadTiles.has(tileId(x, z))) continue;

			const nearRoad =
				roadTiles.has(tileId((x + 1) % WORLD_GRID_SIZE, z)) ||
				roadTiles.has(tileId((x - 1 + WORLD_GRID_SIZE) % WORLD_GRID_SIZE, z)) ||
				roadTiles.has(tileId(x, (z + 1) % WORLD_GRID_SIZE)) ||
				roadTiles.has(tileId(x, (z - 1 + WORLD_GRID_SIZE) % WORLD_GRID_SIZE));
			const roll = random();
			let kind: PropKind | undefined;

			if (nearRoad && roll < 0.035) kind = 'cottage';
			else if (roll < 0.18) kind = 'tree';
			else if (roll < 0.225) kind = 'rock';
			else if (roll < 0.27) kind = 'flowers';
			if (!kind) continue;

			const jitter = kind === 'cottage' ? 0.08 : 0.26;
			const propX = tileToWorld(x) + (random() - 0.5) * WORLD_TILE_SIZE * jitter;
			const propZ = tileToWorld(z) + (random() - 0.5) * WORLD_TILE_SIZE * jitter;
			if (isNearBuilding(buildings, { x: propX, z: propZ }, kind === 'cottage' ? 5 : 3.5)) {
				continue;
			}
			props.push({
				kind,
				x: propX,
				z: propZ,
				rotation: random() * Math.PI * 2,
				scale: 0.82 + random() * 0.36,
			});
		}
	}

	return {
		gridSize: WORLD_GRID_SIZE,
		tileSize: WORLD_TILE_SIZE,
		worldSpan: WORLD_SPAN,
		roads,
		props,
		grass,
		buildings,
	};
}

export function createTerrainIndex(
	layout: RoadLayout & { grass?: readonly GrassPlacement[] },
): TerrainIndex {
	const roadSurface = createRoadSurfaceQuery(layout);
	const isRoadAt = (x: number, z: number) => roadSurface.containsPoint(x, z);
	const grassBuckets = new Map<number, GrassPlacement[]>();
	for (const grass of layout.grass ?? []) {
		const key = layoutTileKeyAtWorldPosition(layout, grass.x, grass.z);
		const bucket = grassBuckets.get(key) ?? [];
		bucket.push(grass);
		grassBuckets.set(key, bucket);
	}

	return {
		isRoadAt,
		surfaceAt(x, z) {
			return isRoadAt(x, z) ? 'road' : 'meadow';
		},
		grassDensityAt(x, z) {
			if (isRoadAt(x, z) || grassBuckets.size === 0) return 0;
			const tileX = worldPositionToTileIndex(layout, x);
			const tileZ = worldPositionToTileIndex(layout, z);
			let density = 0;
			for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
				for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
					const key = layoutTileKey(layout, tileX + offsetX, tileZ + offsetZ);
					for (const grass of grassBuckets.get(key) ?? []) {
						const distance = Math.hypot(
							wrappedDistance(x, grass.x, layout.worldSpan),
							wrappedDistance(z, grass.z, layout.worldSpan),
						);
						const patchRadius = grassPatchRadius(grass.kind, grass.scale);
						const contactRadius = patchRadius + 0.9;
						density = Math.max(density, 1 - distance / contactRadius);
					}
				}
			}
			return Math.max(0, Math.min(1, density));
		},
	};
}

function wrapLayoutIndex(value: number, gridSize: number): number {
	return ((value % gridSize) + gridSize) % gridSize;
}

function worldPositionToTileIndex(layout: RoadLayout, value: number): number {
	return Math.floor(
		(wrapWorldCoordinate(value, layout.worldSpan) + layout.worldSpan / 2) / layout.tileSize,
	);
}

function layoutTileKey(layout: RoadLayout, tileX: number, tileZ: number): number {
	return (
		wrapLayoutIndex(tileX, layout.gridSize) +
		wrapLayoutIndex(tileZ, layout.gridSize) * layout.gridSize
	);
}

function layoutTileKeyAtWorldPosition(layout: RoadLayout, x: number, z: number): number {
	return layoutTileKey(
		layout,
		worldPositionToTileIndex(layout, x),
		worldPositionToTileIndex(layout, z),
	);
}

export function getRoadsidePosts(layout: RoadLayout): WorldPoint[] {
	const roadTiles = new Set(layout.roads.map((road) => road.z * layout.gridSize + road.x));
	const directions = [
		{ x: 1, z: 0 },
		{ x: -1, z: 0 },
		{ x: 0, z: 1 },
		{ x: 0, z: -1 },
	] as const;
	const roadsideOffset = layout.tileSize / 2 + 0.5;

	return layout.roads.flatMap((road, index) => {
		if (index % 9 !== 0) return [];

		for (const direction of directions) {
			const neighborX = wrapLayoutIndex(road.x + direction.x, layout.gridSize);
			const neighborZ = wrapLayoutIndex(road.z + direction.z, layout.gridSize);
			if (roadTiles.has(neighborZ * layout.gridSize + neighborX)) continue;

			return [
				{
					x: wrapWorldCoordinate(
						(road.x + 0.5) * layout.tileSize - layout.worldSpan / 2 + direction.x * roadsideOffset,
						layout.worldSpan,
					),
					z: wrapWorldCoordinate(
						(road.z + 0.5) * layout.tileSize - layout.worldSpan / 2 + direction.z * roadsideOffset,
						layout.worldSpan,
					),
				},
			];
		}

		return [];
	});
}

export function createCollisionIndex(
	layout: RoadLayout & {
		props: readonly PropPlacement[];
		buildings?: readonly BuildingPlacement[];
	},
): CollisionIndex {
	const radiusByKind: Readonly<Record<Exclude<PropKind, 'flowers'>, number>> = {
		tree: 1.25,
		rock: 0.9,
		cottage: 2.2,
	};
	const obstacles = layout.props.flatMap((prop) => {
		if (prop.kind === 'flowers') return [];
		return [{ x: prop.x, z: prop.z, radius: radiusByKind[prop.kind] * prop.scale }];
	});
	for (const building of layout.buildings ?? []) {
		obstacles.push({ x: building.x, z: building.z, radius: 2.75 * building.scale });
	}
	for (const post of getRoadsidePosts(layout)) obstacles.push({ ...post, radius: 0.25 });

	return {
		intersectsCircle(x, z, radius) {
			return obstacles.some((obstacle) => {
				const distanceX = wrappedDistance(x, obstacle.x, layout.worldSpan);
				const distanceZ = wrappedDistance(z, obstacle.z, layout.worldSpan);
				const minimumDistance = radius + obstacle.radius;
				return distanceX * distanceX + distanceZ * distanceZ < minimumDistance * minimumDistance;
			});
		},
	};
}
