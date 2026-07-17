import { createRoadSurfaceQuery } from './road-surface';

export const WORLD_GRID_SIZE = 18;
export const WORLD_TILE_SIZE = 8;
export const WORLD_SPAN = WORLD_GRID_SIZE * WORLD_TILE_SIZE;

export interface TileCoordinate {
	x: number;
	z: number;
}

export type PropKind = 'tree' | 'rock' | 'flowers' | 'cottage';

export interface PropPlacement {
	kind: PropKind;
	x: number;
	z: number;
	rotation: number;
	scale: number;
}

export interface WorldLayout {
	gridSize: number;
	tileSize: number;
	worldSpan: number;
	roads: TileCoordinate[];
	props: PropPlacement[];
}

export interface RoadIndex {
	hasWorldPosition(x: number, z: number): boolean;
	surfaceAt(x: number, z: number): 'road' | 'meadow';
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
			props.push({
				kind,
				x: tileToWorld(x) + (random() - 0.5) * WORLD_TILE_SIZE * jitter,
				z: tileToWorld(z) + (random() - 0.5) * WORLD_TILE_SIZE * jitter,
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
	};
}

export function createRoadIndex(layout: WorldLayout): RoadIndex {
	const roadSurface = createRoadSurfaceQuery(layout);
	const hasWorldPosition = (x: number, z: number) => roadSurface.containsPoint(x, z);

	return {
		hasWorldPosition,
		surfaceAt(x, z) {
			return hasWorldPosition(x, z) ? 'road' : 'meadow';
		},
	};
}

export function getRoadsidePosts(layout: WorldLayout): WorldPoint[] {
	const roadTiles = new Set(layout.roads.map((road) => road.z * layout.gridSize + road.x));
	const directions = [
		{ x: 1, z: 0 },
		{ x: -1, z: 0 },
		{ x: 0, z: 1 },
		{ x: 0, z: -1 },
	] as const;
	const wrapLayoutTile = (value: number) =>
		((value % layout.gridSize) + layout.gridSize) % layout.gridSize;
	const roadsideOffset = layout.tileSize / 2 + 0.5;

	return layout.roads.flatMap((road, index) => {
		if (index % 9 !== 0) return [];

		for (const direction of directions) {
			const neighborX = wrapLayoutTile(road.x + direction.x);
			const neighborZ = wrapLayoutTile(road.z + direction.z);
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

export function createCollisionIndex(layout: WorldLayout): CollisionIndex {
	const radiusByKind: Readonly<Record<Exclude<PropKind, 'flowers'>, number>> = {
		tree: 1.25,
		rock: 0.9,
		cottage: 2.2,
	};
	const obstacles = layout.props.flatMap((prop) => {
		if (prop.kind === 'flowers') return [];
		return [{ x: prop.x, z: prop.z, radius: radiusByKind[prop.kind] * prop.scale }];
	});
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
