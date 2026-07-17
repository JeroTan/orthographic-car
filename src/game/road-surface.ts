import type { WorldLayout } from './world';

export interface RoadSurfaceData {
	positions: Float32Array;
	uvs: Float32Array;
	indices: number[];
}

export interface RoadCornerJoin {
	x: number;
	z: number;
	directionX: -1 | 1;
	directionZ: -1 | 1;
	depth: number;
}

export interface RoadSurfaceQuery {
	containsPoint(x: number, z: number): boolean;
}

const ROAD_CORNER_SEGMENTS = 8;

function roadTileKey(layout: WorldLayout, x: number, z: number): number {
	return z * layout.gridSize + x;
}

function wrapGridIndex(value: number, gridSize: number): number {
	return ((value % gridSize) + gridSize) % gridSize;
}

function wrapCoordinate(value: number, span: number): number {
	const halfSpan = span / 2;
	return ((((value + halfSpan) % span) + span) % span) - halfSpan;
}

function wrappedDelta(value: number, origin: number, span: number): number {
	return wrapCoordinate(value - origin, span);
}

function roadTileSet(layout: WorldLayout): Set<number> {
	return new Set(layout.roads.map((road) => roadTileKey(layout, road.x, road.z)));
}

export function getRoadCornerJoins(layout: WorldLayout): RoadCornerJoin[] {
	const roadTiles = roadTileSet(layout);
	const joins: RoadCornerJoin[] = [];
	const origin = -layout.worldSpan / 2;
	const depth = layout.tileSize * 0.18;

	for (let gridZ = 0; gridZ < layout.gridSize; gridZ += 1) {
		for (let gridX = 0; gridX < layout.gridSize; gridX += 1) {
			const quadrants = [
				{
					tileX: wrapGridIndex(gridX - 1, layout.gridSize),
					tileZ: wrapGridIndex(gridZ - 1, layout.gridSize),
					directionX: -1,
					directionZ: -1,
				},
				{
					tileX: gridX,
					tileZ: wrapGridIndex(gridZ - 1, layout.gridSize),
					directionX: 1,
					directionZ: -1,
				},
				{
					tileX: wrapGridIndex(gridX - 1, layout.gridSize),
					tileZ: gridZ,
					directionX: -1,
					directionZ: 1,
				},
				{ tileX: gridX, tileZ: gridZ, directionX: 1, directionZ: 1 },
			] as const;
			const emptyQuadrants = quadrants.filter(
				(quadrant) => !roadTiles.has(roadTileKey(layout, quadrant.tileX, quadrant.tileZ)),
			);
			if (emptyQuadrants.length !== 1) continue;

			const empty = emptyQuadrants[0];
			joins.push({
				x: origin + gridX * layout.tileSize,
				z: origin + gridZ * layout.tileSize,
				directionX: empty.directionX,
				directionZ: empty.directionZ,
				depth,
			});
		}
	}

	return joins;
}

export function createRoadSurfaceQuery(layout: WorldLayout): RoadSurfaceQuery {
	const roadTiles = roadTileSet(layout);
	const joins = getRoadCornerJoins(layout);

	return {
		containsPoint(x, z) {
			const wrappedX = wrapCoordinate(x, layout.worldSpan);
			const wrappedZ = wrapCoordinate(z, layout.worldSpan);
			const tileX = Math.floor((wrappedX + layout.worldSpan / 2) / layout.tileSize);
			const tileZ = Math.floor((wrappedZ + layout.worldSpan / 2) / layout.tileSize);
			if (roadTiles.has(roadTileKey(layout, tileX, tileZ))) return true;

			return joins.some((join) => {
				const distanceX = wrappedDelta(wrappedX, join.x, layout.worldSpan) * join.directionX;
				const distanceZ = wrappedDelta(wrappedZ, join.z, layout.worldSpan) * join.directionZ;
				return (
					distanceX >= 0 &&
					distanceZ >= 0 &&
					distanceX * distanceX + distanceZ * distanceZ <= join.depth * join.depth
				);
			});
		},
	};
}

export function buildRoadSurface(layout: WorldLayout): RoadSurfaceData {
	const positions: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];
	const vertices = new Map<string, number>();
	const origin = -layout.worldSpan / 2;
	const textureScale = layout.tileSize * 2;

	function vertex(x: number, z: number): number {
		const key = `${x}:${z}`;
		const existing = vertices.get(key);
		if (existing !== undefined) return existing;

		const index = positions.length / 3;
		positions.push(x, 0, z);
		uvs.push((x - origin) / textureScale, (z - origin) / textureScale);
		vertices.set(key, index);
		return index;
	}

	function triangle(
		a: readonly [number, number],
		b: readonly [number, number],
		c: readonly [number, number],
	): void {
		const normalY =
			(b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
		const first = vertex(a[0], a[1]);
		const second = vertex(b[0], b[1]);
		const third = vertex(c[0], c[1]);
		indices.push(first, ...(normalY >= 0 ? [second, third] : [third, second]));
	}

	for (const road of layout.roads) {
		const x0 = origin + road.x * layout.tileSize;
		const x1 = x0 + layout.tileSize;
		const z0 = origin + road.z * layout.tileSize;
		const z1 = z0 + layout.tileSize;
		const bottomLeft = vertex(x0, z0);
		const topLeft = vertex(x0, z1);
		const topRight = vertex(x1, z1);
		const bottomRight = vertex(x1, z0);

		indices.push(bottomLeft, topLeft, topRight, bottomLeft, topRight, bottomRight);
	}

	for (const join of getRoadCornerJoins(layout)) {
		let previous: readonly [number, number] = [
			join.x + join.directionX * join.depth,
			join.z,
		];

		for (let segment = 1; segment <= ROAD_CORNER_SEGMENTS; segment += 1) {
			const angle = (segment / ROAD_CORNER_SEGMENTS) * (Math.PI / 2);
			const next: readonly [number, number] = [
				join.x + join.directionX * Math.cos(angle) * join.depth,
				join.z + join.directionZ * Math.sin(angle) * join.depth,
			];
			triangle([join.x, join.z], previous, next);
			previous = next;
		}
	}

	return {
		positions: new Float32Array(positions),
		uvs: new Float32Array(uvs),
		indices,
	};
}
