import { createRoadSurfaceQuery } from './road-surface';

export const WORLD_GRID_SIZE = 64;
export const WORLD_TILE_SIZE = 8;
export const WORLD_SPAN = WORLD_GRID_SIZE * WORLD_TILE_SIZE;
export const REPEATED_WORLD_OFFSETS = [-1, 0, 1] as const;
export const WORLD_BUILDING_MIN_COUNT = 48;
export const WORLD_BUILDING_MAX_COUNT = 96;

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
	normalAt(x: number, z: number, radius: number): { x: number; z: number } | undefined;
}

function wrappedDistance(a: number, b: number, span: number) {
	const direct = Math.abs(a - b) % span;
	return Math.min(direct, span - direct);
}

function wrappedDelta(value: number, span: number) {
	const halfSpan = span / 2;
	return ((((value + halfSpan) % span) + span) % span) - halfSpan;
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

function outerRoadBand(random: () => number): number {
	const innerMinimum = Math.max(1, Math.floor(WORLD_GRID_SIZE * 0.18));
	const innerMaximum = Math.max(innerMinimum, Math.floor(WORLD_GRID_SIZE * 0.34));
	return random() < 0.5
		? randomInteger(random, innerMinimum, innerMaximum)
		: randomInteger(
				random,
				WORLD_GRID_SIZE - 1 - innerMaximum,
				WORLD_GRID_SIZE - 1 - innerMinimum,
			);
}

function collectorBoundary(random: () => number): number {
	const minimum = Math.max(1, Math.floor(WORLD_GRID_SIZE * 0.18));
	const maximum = Math.max(minimum, Math.floor(WORLD_GRID_SIZE * 0.3));
	return randomInteger(random, minimum, maximum);
}

function addCollectorLoop(roadTiles: Set<number>, random: () => number): void {
	const west = collectorBoundary(random);
	const east = WORLD_GRID_SIZE - 1 - collectorBoundary(random);
	const north = collectorBoundary(random);
	const south = WORLD_GRID_SIZE - 1 - collectorBoundary(random);

	addHorizontalRoad(roadTiles, north, west, east);
	addHorizontalRoad(roadTiles, south, west, east);
	addVerticalRoad(roadTiles, west, north, south);
	addVerticalRoad(roadTiles, east, north, south);
}

function randomOuterRoad(random: () => number): number {
	return outerRoadBand(random);
}

function addParallelGrid(roadTiles: Set<number>, random: () => number): void {
	addHorizontalRoad(roadTiles, randomOuterRoad(random), 0, WORLD_GRID_SIZE - 1);
	addVerticalRoad(roadTiles, randomOuterRoad(random), 0, WORLD_GRID_SIZE - 1);
}

function roadBlockAt(roadTiles: ReadonlySet<number>, x: number, z: number): boolean {
	return [
		[x, z],
		[x + 1, z],
		[x, z + 1],
		[x + 1, z + 1],
	].every(([tileX, tileZ]) => roadTiles.has(tileId(wrapTile(tileX), wrapTile(tileZ))));
}

function tryAddRoadSegment(
	roadTiles: Set<number>,
	coordinates: ReadonlyArray<readonly [number, number]>,
): boolean {
	const added = coordinates
		.map(([x, z]) => tileId(wrapTile(x), wrapTile(z)))
		.filter((id) => !roadTiles.has(id));
	for (const id of added) roadTiles.add(id);

	const createsBlock = added.some((id) => {
		const x = id % WORLD_GRID_SIZE;
		const z = Math.floor(id / WORLD_GRID_SIZE);
		return [-1, 0].some((offsetX) =>
			[-1, 0].some((offsetZ) => roadBlockAt(roadTiles, x + offsetX, z + offsetZ)),
		);
	});
	if (!createsBlock) return true;

	for (const id of added) roadTiles.delete(id);
	return false;
}

function shuffledRange(random: () => number, minimum: number, maximum: number): number[] {
	const values = Array.from(
		{ length: maximum - minimum + 1 },
		(_, index) => minimum + index,
	);
	for (let index = values.length - 1; index > 0; index -= 1) {
		const swapIndex = Math.floor(random() * (index + 1));
		[values[index], values[swapIndex]] = [values[swapIndex], values[index]];
	}
	return values;
}

function tryAddHorizontalArterial(
	roadTiles: Set<number>,
	random: () => number,
	minimum: number,
	maximum: number,
): boolean {
	for (const z of shuffledRange(random, minimum, maximum)) {
		const coordinates = Array.from(
			{ length: WORLD_GRID_SIZE },
			(_, x) => [x, z] as const,
		);
		if (tryAddRoadSegment(roadTiles, coordinates)) return true;
	}
	return false;
}

function tryAddVerticalArterial(
	roadTiles: Set<number>,
	random: () => number,
	minimum: number,
	maximum: number,
): boolean {
	for (const x of shuffledRange(random, minimum, maximum)) {
		const coordinates = Array.from(
			{ length: WORLD_GRID_SIZE },
			(_, z) => [x, z] as const,
		);
		if (tryAddRoadSegment(roadTiles, coordinates)) return true;
	}
	return false;
}

function addSecondaryArterials(roadTiles: Set<number>, random: () => number): void {
	const boundaryMinimum = Math.max(1, Math.floor(WORLD_GRID_SIZE * 0.18));
	const boundaryMaximum = Math.max(boundaryMinimum, Math.floor(WORLD_GRID_SIZE * 0.3));
	const oppositeMinimum = WORLD_GRID_SIZE - 1 - boundaryMaximum;
	const oppositeMaximum = WORLD_GRID_SIZE - 1 - boundaryMinimum;

	// Retry alternate bands when seeded collector segments would create a 2×2
	// asphalt block. Keep each side balanced so every plan gets readable blocks.
	tryAddHorizontalArterial(roadTiles, random, boundaryMinimum, boundaryMaximum);
	tryAddHorizontalArterial(roadTiles, random, oppositeMinimum, oppositeMaximum);
	tryAddVerticalArterial(roadTiles, random, boundaryMinimum, boundaryMaximum);
	tryAddVerticalArterial(roadTiles, random, oppositeMinimum, oppositeMaximum);
}

function addCornerBlock(roadTiles: Set<number>, outerX: number, outerZ: number): void {
	const anchor = WORLD_GRID_SIZE / 2;
	addHorizontalRoad(roadTiles, outerZ, Math.min(outerX, anchor), Math.max(outerX, anchor));
	addVerticalRoad(roadTiles, outerX, Math.min(outerZ, anchor), Math.max(outerZ, anchor));
}

function addStaggeredBlocks(roadTiles: Set<number>, random: () => number): void {
	const west = collectorBoundary(random);
	const east = WORLD_GRID_SIZE - 1 - collectorBoundary(random);
	const north = collectorBoundary(random);
	const south = WORLD_GRID_SIZE - 1 - collectorBoundary(random);

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

interface BuildingProximityIndex {
	add(building: BuildingPlacement): void;
	isNear(point: WorldPoint, clearance: number): boolean;
}

function buildingBucketIndex(value: number): number {
	return Math.floor(
		(wrapWorldCoordinate(value, WORLD_SPAN) + WORLD_SPAN / 2) / WORLD_TILE_SIZE,
	);
}

function createBuildingProximityIndex(): BuildingProximityIndex {
	const buckets = new Map<number, BuildingPlacement[]>();

	return {
		add(building) {
			const key = tileId(buildingBucketIndex(building.x), buildingBucketIndex(building.z));
			const bucket = buckets.get(key) ?? [];
			bucket.push(building);
			buckets.set(key, bucket);
		},
		isNear(point, clearance) {
			const centerX = buildingBucketIndex(point.x);
			const centerZ = buildingBucketIndex(point.z);
			const bucketRadius = Math.ceil(clearance / WORLD_TILE_SIZE);

			for (let offsetZ = -bucketRadius; offsetZ <= bucketRadius; offsetZ += 1) {
				for (let offsetX = -bucketRadius; offsetX <= bucketRadius; offsetX += 1) {
					const key = tileId(wrapTile(centerX + offsetX), wrapTile(centerZ + offsetZ));
					for (const building of buckets.get(key) ?? []) {
						if (wrappedPointDistance(building, point, WORLD_SPAN) < clearance) return true;
					}
				}
			}

			return false;
		},
	};
}

function generateBuildings(roadTiles: ReadonlySet<number>, seed: number): BuildingPlacement[] {
	const random = createRandom(seed ^ 0x51ed270b);
	const spacing = [6.5, 7, 7.5][Math.floor(random() * 3)];
	const variantOffset = Math.floor(random() * 6);
	const buildings: BuildingPlacement[] = [];
	const buildingProximity = createBuildingProximityIndex();
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
		if (
			buildings.length >= WORLD_BUILDING_MAX_COUNT ||
			buildingProximity.isNear(candidate, spacing)
		) {
			return;
		}
		const building = {
			variant: ((variantOffset + buildings.length) % 6) as BuildingVariant,
			x: candidate.x,
			z: candidate.z,
			rotation: candidate.rotation,
			scale: candidate.scale,
		};
		buildings.push(building);
		buildingProximity.add(building);
	}

	// Randomized candidate order spreads buildings across full map instead of
	// filling first rows and leaving central roads empty on larger maps.
	candidates.sort((first, second) => first.roll - second.roll);
	for (const candidate of candidates) {
		if (candidate.roll < 0.78) place(candidate);
	}
	if (buildings.length < WORLD_BUILDING_MIN_COUNT) {
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
	addSecondaryArterials(roadTiles, roadRandom);

	const roads = [...roadTiles].map((id) => {
		return { x: id % WORLD_GRID_SIZE, z: Math.floor(id / WORLD_GRID_SIZE) };
	});
	const buildings = generateBuildings(roadTiles, seed);
	const grassRandom = createRandom(seed ^ 0x7f4a7c15);
	const grass: GrassPlacement[] = [];
	const buildingProximity = createBuildingProximityIndex();
	for (const building of buildings) buildingProximity.add(building);
	const roadSurface = createRoadSurfaceQuery({
		gridSize: WORLD_GRID_SIZE,
		tileSize: WORLD_TILE_SIZE,
		worldSpan: WORLD_SPAN,
		roads,
	});
	for (let z = 0; z < WORLD_GRID_SIZE; z += 1) {
		for (let x = 0; x < WORLD_GRID_SIZE; x += 1) {
			if (roadTiles.has(tileId(x, z))) continue;

			for (let patch = 0; patch < 2; patch += 1) {
				const grassX = tileToWorld(x) + (grassRandom() - 0.5) * WORLD_TILE_SIZE * 0.84;
				const grassZ = tileToWorld(z) + (grassRandom() - 0.5) * WORLD_TILE_SIZE * 0.84;
				if (buildingProximity.isNear({ x: grassX, z: grassZ }, 5)) continue;
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
			if (buildingProximity.isNear({ x: propX, z: propZ }, kind === 'cottage' ? 6 : 4.5)) {
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
	void layout;
	return [];
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
		obstacles.push({ x: building.x, z: building.z, radius: 3.5 * building.scale });
	}
	return {
		intersectsCircle(x, z, radius) {
			return obstacles.some((obstacle) => {
				const distanceX = wrappedDistance(x, obstacle.x, layout.worldSpan);
				const distanceZ = wrappedDistance(z, obstacle.z, layout.worldSpan);
				const minimumDistance = radius + obstacle.radius;
				return distanceX * distanceX + distanceZ * distanceZ < minimumDistance * minimumDistance;
			});
		},
		normalAt(x, z, radius) {
			let nearest: { x: number; z: number; distanceSquared: number } | undefined;

			for (const obstacle of obstacles) {
				const deltaX = wrappedDelta(x - obstacle.x, layout.worldSpan);
				const deltaZ = wrappedDelta(z - obstacle.z, layout.worldSpan);
				const distanceSquared = deltaX * deltaX + deltaZ * deltaZ;
				const minimumDistance = radius + obstacle.radius;
				if (distanceSquared >= minimumDistance * minimumDistance) continue;
				if (!nearest || distanceSquared < nearest.distanceSquared) {
					nearest = { x: deltaX, z: deltaZ, distanceSquared };
				}
			}

			if (!nearest || nearest.distanceSquared <= 0.000001) return undefined;
			const distance = Math.sqrt(nearest.distanceSquared);
			return { x: nearest.x / distance, z: nearest.z / distance };
		},
	};
}
