import type { RoadLayout } from './world';
import {
	roadLaneWidth,
	roadProfileFor,
	roadWidth,
} from './road-network';

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

export interface RoadDecorationRect {
	x: number;
	z: number;
	width: number;
	depth: number;
	rotation?: number;
}

export interface RoadDecorationData {
	centerDashes: RoadDecorationRect[];
	laneDashes: RoadDecorationRect[];
	edgeLines: RoadDecorationRect[];
	pavements: RoadDecorationRect[];
	crosswalkStripes: RoadDecorationRect[];
}

const ROAD_CORNER_SEGMENTS = 8;
const CROSSWALK_STRIPE_COUNT = 7;
const CROSSWALK_STRIPE_LENGTH_FACTOR = 0.36;
const CROSSWALK_STRIPE_THICKNESS_FACTOR = 0.055;
const CROSSWALK_STRIPE_SPACING_FACTOR = 0.11;
const CROSSWALK_APPROACH_OFFSET_FACTOR = 0.26;
const CROSSWALK_STRIPE_ROTATION = Math.PI / 2;

function roadTileKey(layout: RoadLayout, x: number, z: number): number {
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

function roadTileSet(layout: RoadLayout): Set<number> {
	return new Set(layout.roads.map((road) => roadTileKey(layout, road.x, road.z)));
}

function roadTileMap(layout: RoadLayout) {
	return new Map(
		layout.roads.map((road) => [roadTileKey(layout, road.x, road.z), road] as const),
	);
}

function roadRectangle(
	layout: RoadLayout,
	roadTiles: ReadonlySet<number>,
	road: RoadLayout['roads'][number],
): { halfWidth: number; halfDepth: number } {
	const hasRoad = (x: number, z: number) =>
		roadTiles.has(
			roadTileKey(
				layout,
				wrapGridIndex(x, layout.gridSize),
				wrapGridIndex(z, layout.gridSize),
			),
		);
	const horizontal = hasRoad(road.x - 1, road.z) || hasRoad(road.x + 1, road.z);
	const vertical = hasRoad(road.x, road.z - 1) || hasRoad(road.x, road.z + 1);
	const profile = roadProfileFor(road.roadClass);
	const halfTile = layout.tileSize / 2;
	const halfRoad = roadWidth(profile, layout.tileSize) / 2;

	if (profile.roadClass === 'local') {
		return { halfWidth: halfTile, halfDepth: halfTile };
	}
	if (horizontal && !vertical) {
		return { halfWidth: halfTile, halfDepth: halfRoad };
	}
	if (vertical && !horizontal) {
		return { halfWidth: halfRoad, halfDepth: halfTile };
	}
	return { halfWidth: halfRoad, halfDepth: halfRoad };
}

export function buildRoadDecorations(layout: RoadLayout): RoadDecorationData {
	const roadTiles = roadTileSet(layout);
	const roads = roadTileMap(layout);
	const centerDashes: RoadDecorationRect[] = [];
	const laneDashes: RoadDecorationRect[] = [];
	const edgeLines: RoadDecorationRect[] = [];
	const pavements: RoadDecorationRect[] = [];
	const crosswalkStripes: RoadDecorationRect[] = [];
	const origin = -layout.worldSpan / 2;
	const halfTile = layout.tileSize / 2;
	const pavementDepth = Math.min(0.8, layout.tileSize * 0.1);
	const lineThickness = Math.min(0.12, layout.tileSize * 0.015);
	const crosswalkStripeLength = layout.tileSize * CROSSWALK_STRIPE_LENGTH_FACTOR;
	const crosswalkStripeThickness = layout.tileSize * CROSSWALK_STRIPE_THICKNESS_FACTOR;
	const crosswalkStripeSpacing = layout.tileSize * CROSSWALK_STRIPE_SPACING_FACTOR;
	const crosswalkApproachOffset = layout.tileSize * CROSSWALK_APPROACH_OFFSET_FACTOR;

	function hasRoad(x: number, z: number): boolean {
		return roadTiles.has(
			roadTileKey(
				layout,
				wrapGridIndex(x, layout.gridSize),
				wrapGridIndex(z, layout.gridSize),
			),
		);
	}

	function connectedRoadRectangle(x: number, z: number) {
		const road = roads.get(
			roadTileKey(
				layout,
				wrapGridIndex(x, layout.gridSize),
				wrapGridIndex(z, layout.gridSize),
			),
		);
		return road ? roadRectangle(layout, roadTiles, road) : undefined;
	}

	function addStraightCenterDashes(
		centerX: number,
		centerZ: number,
		orientation: 'horizontal' | 'vertical',
	): void {
		for (const offset of [-layout.tileSize * 0.22, layout.tileSize * 0.22]) {
			centerDashes.push({
				x: centerX + (orientation === 'horizontal' ? offset : 0),
				z: centerZ + (orientation === 'vertical' ? offset : 0),
				width: orientation === 'horizontal' ? layout.tileSize * 0.28 : lineThickness,
				depth: orientation === 'vertical' ? layout.tileSize * 0.28 : lineThickness,
			});
		}
	}

	for (const road of layout.roads) {
		const profile = roadProfileFor(road.roadClass);
		const profileRoadWidth = roadWidth(profile, layout.tileSize);
		const profileHalfRoad = profileRoadWidth / 2;
		const centerX = origin + (road.x + 0.5) * layout.tileSize;
		const centerZ = origin + (road.z + 0.5) * layout.tileSize;
		const west = hasRoad(road.x - 1, road.z);
		const east = hasRoad(road.x + 1, road.z);
		const north = hasRoad(road.x, road.z - 1);
		const south = hasRoad(road.x, road.z + 1);
		const connectedDirections = [
			{ connected: west, x: -1, z: 0 },
			{ connected: east, x: 1, z: 0 },
			{ connected: north, x: 0, z: -1 },
			{ connected: south, x: 0, z: 1 },
		] as const;

		if (west && east && !north && !south) {
			addStraightCenterDashes(centerX, centerZ, 'horizontal');
			if (profile.laneCount > 2) {
				const laneWidth = roadLaneWidth(profile, layout.tileSize);
				for (const laneSide of [-1, 1]) {
					for (const offset of [-layout.tileSize * 0.22, layout.tileSize * 0.22]) {
						laneDashes.push({
							x: centerX + offset,
							z: centerZ + laneSide * laneWidth,
							width: layout.tileSize * 0.28,
							depth: lineThickness,
						});
					}
				}
			}
		}
		if (north && south && !west && !east) {
			addStraightCenterDashes(centerX, centerZ, 'vertical');
			if (profile.laneCount > 2) {
				const laneWidth = roadLaneWidth(profile, layout.tileSize);
				for (const laneSide of [-1, 1]) {
					for (const offset of [-layout.tileSize * 0.22, layout.tileSize * 0.22]) {
						laneDashes.push({
							x: centerX + laneSide * laneWidth,
							z: centerZ + offset,
							width: lineThickness,
							depth: layout.tileSize * 0.28,
						});
					}
				}
			}
		}
		const horizontalDirection = west !== east ? (west ? -1 : 1) : 0;
		const verticalDirection = north !== south ? (north ? -1 : 1) : 0;
		if (horizontalDirection !== 0 && verticalDirection !== 0) {
			const curveCenterX = centerX + horizontalDirection * halfTile;
			const curveCenterZ = centerZ + verticalDirection * halfTile;
			const turnSegments = 6;
			for (let segment = 0; segment < turnSegments; segment += 2) {
				const angle = ((segment + 0.5) / turnSegments) * (Math.PI / 2);
				const tangentX = -horizontalDirection * Math.cos(angle);
				const tangentZ = verticalDirection * Math.sin(angle);
				centerDashes.push({
					x: curveCenterX - horizontalDirection * halfTile * Math.sin(angle),
					z: curveCenterZ - verticalDirection * halfTile * Math.cos(angle),
					width: halfTile * (Math.PI / 2 / turnSegments) * 0.82,
					depth: lineThickness,
					rotation: Math.atan2(-tangentZ, tangentX),
				});
			}
		}
		if (connectedDirections.filter((direction) => direction.connected).length >= 3) {
			const crosswalkStripeCount =
				profile.laneCount > 2 ? CROSSWALK_STRIPE_COUNT + 4 : CROSSWALK_STRIPE_COUNT;
			for (const direction of connectedDirections) {
				if (!direction.connected) continue;
				for (let stripe = 0; stripe < crosswalkStripeCount; stripe += 1) {
					const approachDistance = profileHalfRoad + crosswalkApproachOffset;
					const crossLaneOffset =
						(stripe - (crosswalkStripeCount - 1) / 2) * crosswalkStripeSpacing;
					crosswalkStripes.push({
						x: centerX + direction.x * approachDistance - direction.z * crossLaneOffset,
						z: centerZ + direction.z * approachDistance + direction.x * crossLaneOffset,
						rotation: CROSSWALK_STRIPE_ROTATION,
						// Rotate base rectangle into rendered pedestrian-lane orientation.
						width: direction.x === 0 ? crosswalkStripeLength : crosswalkStripeThickness,
						depth: direction.z === 0 ? crosswalkStripeLength : crosswalkStripeThickness,
					});
				}
			}
		}

		const horizontal = west || east;
		const vertical = north || south;
		const boundaryHalfX = vertical && profile.laneCount > 2 ? profileHalfRoad : halfTile;
		const boundaryHalfZ = horizontal && profile.laneCount > 2 ? profileHalfRoad : halfTile;
		const verticalEdgeDepth = horizontal && profile.laneCount > 2
			? profileRoadWidth
			: layout.tileSize;
		const horizontalEdgeWidth = vertical && profile.laneCount > 2
			? profileRoadWidth
			: layout.tileSize;
		const westTrim = west
			? Math.max(
					0,
					(connectedRoadRectangle(road.x - 1, road.z)?.halfWidth ?? halfTile) -
						halfTile,
				)
			: 0;
		const eastTrim = east
			? Math.max(
					0,
					(connectedRoadRectangle(road.x + 1, road.z)?.halfWidth ?? halfTile) -
						halfTile,
				)
			: 0;
		const northTrim = north
			? Math.max(
					0,
					(connectedRoadRectangle(road.x, road.z - 1)?.halfDepth ?? halfTile) -
						halfTile,
				)
			: 0;
		const southTrim = south
			? Math.max(
					0,
					(connectedRoadRectangle(road.x, road.z + 1)?.halfDepth ?? halfTile) -
						halfTile,
				)
			: 0;
		const horizontalEdgeCenterX = centerX + (westTrim - eastTrim) / 2;
		const horizontalEdgeLength = Math.max(0, layout.tileSize - westTrim - eastTrim);
		const verticalEdgeCenterZ = centerZ + (northTrim - southTrim) / 2;
		const verticalEdgeLength = Math.max(0, layout.tileSize - northTrim - southTrim);
		for (const edge of [
			{
				open: !west,
				x: centerX - boundaryHalfX,
				z: verticalEdgeCenterZ,
				width: lineThickness,
				depth: Math.min(verticalEdgeDepth, verticalEdgeLength),
			},
			{
				open: !east,
				x: centerX + boundaryHalfX,
				z: verticalEdgeCenterZ,
				width: lineThickness,
				depth: Math.min(verticalEdgeDepth, verticalEdgeLength),
			},
			{
				open: !north,
				x: horizontalEdgeCenterX,
				z: centerZ - boundaryHalfZ,
				width: Math.min(horizontalEdgeWidth, horizontalEdgeLength),
				depth: lineThickness,
			},
			{
				open: !south,
				x: horizontalEdgeCenterX,
				z: centerZ + boundaryHalfZ,
				width: Math.min(horizontalEdgeWidth, horizontalEdgeLength),
				depth: lineThickness,
			},
		]) {
			if (!edge.open || edge.width <= 0 || edge.depth <= 0) continue;
			edgeLines.push({ x: edge.x, z: edge.z, width: edge.width, depth: edge.depth });
			pavements.push({
				x: edge.x + Math.sign(edge.x - centerX) * pavementDepth / 2,
				z: edge.z + Math.sign(edge.z - centerZ) * pavementDepth / 2,
				width: edge.width === lineThickness ? pavementDepth : edge.width,
				depth: edge.depth === lineThickness ? pavementDepth : edge.depth,
			});
		}
	}

	const cornerJoins = getRoadCornerJoins(layout);
	const epsilon = 0.001;
	for (const join of cornerJoins) {
		const verticalBoundary = edgeLines.findIndex((edge, index) => {
			if (edge.width !== lineThickness) return false;
			const pavement = pavements[index];
			const endpointZ = edge.z - join.directionZ * edge.depth / 2;
			return (
				Math.abs(edge.x - join.x) < epsilon &&
				Math.abs(endpointZ - join.z) < epsilon &&
				Math.sign(pavement.x - edge.x) === join.directionX
			);
		});
		if (verticalBoundary >= 0) {
			edgeLines[verticalBoundary].z += join.directionZ * join.depth / 2;
			edgeLines[verticalBoundary].depth -= join.depth;
			pavements[verticalBoundary].z += join.directionZ * join.depth / 2;
			pavements[verticalBoundary].depth -= join.depth;
		}

		const horizontalBoundary = edgeLines.findIndex((edge, index) => {
			if (edge.depth !== lineThickness) return false;
			const pavement = pavements[index];
			const endpointX = edge.x - join.directionX * edge.width / 2;
			return (
				Math.abs(edge.z - join.z) < epsilon &&
				Math.abs(endpointX - join.x) < epsilon &&
				Math.sign(pavement.z - edge.z) === join.directionZ
			);
		});
		if (horizontalBoundary >= 0) {
			edgeLines[horizontalBoundary].x += join.directionX * join.depth / 2;
			edgeLines[horizontalBoundary].width -= join.depth;
			pavements[horizontalBoundary].x += join.directionX * join.depth / 2;
			pavements[horizontalBoundary].width -= join.depth;
		}
	}

	const curvedBoundarySegments = 6;
	for (const join of cornerJoins) {
		for (let segment = 0; segment < curvedBoundarySegments; segment += 1) {
			const startAngle = (segment / curvedBoundarySegments) * (Math.PI / 2);
			const endAngle = ((segment + 1) / curvedBoundarySegments) * (Math.PI / 2);
			const angle = (startAngle + endAngle) / 2;
			const tangentX = -join.directionX * Math.sin(angle);
			const tangentZ = join.directionZ * Math.cos(angle);
			const rotation = Math.atan2(-tangentZ, tangentX);
			const lineLength = 2 * join.depth * Math.sin((endAngle - startAngle) / 2) + lineThickness;
			const pavementRadius = join.depth + pavementDepth / 2;
			const pavementLength =
				2 * pavementRadius * Math.sin((endAngle - startAngle) / 2) + lineThickness;
			edgeLines.push({
				x: join.x + join.directionX * Math.cos(angle) * join.depth,
				z: join.z + join.directionZ * Math.sin(angle) * join.depth,
				width: lineLength,
				depth: lineThickness,
				rotation,
			});
			pavements.push({
				x: join.x + join.directionX * Math.cos(angle) * pavementRadius,
				z: join.z + join.directionZ * Math.sin(angle) * pavementRadius,
				width: pavementLength,
				depth: pavementDepth,
				rotation,
			});
		}
	}

	return { centerDashes, laneDashes, edgeLines, pavements, crosswalkStripes };
}

export function getRoadCornerJoins(layout: RoadLayout): RoadCornerJoin[] {
	const roadTiles = roadTileSet(layout);
	const roads = roadTileMap(layout);
	const joins: RoadCornerJoin[] = [];
	const origin = -layout.worldSpan / 2;
	const depth = layout.tileSize * 0.18;
	const roadNeighborCount = (x: number, z: number) => {
		const neighborKeys = new Set(
			[
				[x - 1, z],
				[x + 1, z],
				[x, z - 1],
				[x, z + 1],
			].map(([neighborX, neighborZ]) =>
				roadTileKey(
					layout,
					wrapGridIndex(neighborX, layout.gridSize),
					wrapGridIndex(neighborZ, layout.gridSize),
				),
			),
		);
		let count = 0;
		for (const key of neighborKeys) {
			if (roadTiles.has(key)) count += 1;
		}
		return count;
	};

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
			if (
				quadrants.some(
					(quadrant) =>
						roadTiles.has(roadTileKey(layout, quadrant.tileX, quadrant.tileZ)) &&
						roadNeighborCount(quadrant.tileX, quadrant.tileZ) >= 3,
				)
			) {
				continue;
			}
			if (
				quadrants.some((quadrant) => {
					const road = roads.get(roadTileKey(layout, quadrant.tileX, quadrant.tileZ));
					return road && roadProfileFor(road.roadClass).laneCount > 2;
				})
			) {
				continue;
			}

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

export function createRoadSurfaceQuery(layout: RoadLayout): RoadSurfaceQuery {
	const roadTiles = roadTileSet(layout);
	const roads = roadTileMap(layout);
	const origin = -layout.worldSpan / 2;
	const joins = getRoadCornerJoins(layout);
	const joinBuckets = new Map<number, RoadCornerJoin[]>();
	for (const join of joins) {
		const tileX = wrapGridIndex(
			Math.floor((wrapCoordinate(join.x, layout.worldSpan) + layout.worldSpan / 2) / layout.tileSize),
			layout.gridSize,
		);
		const tileZ = wrapGridIndex(
			Math.floor((wrapCoordinate(join.z, layout.worldSpan) + layout.worldSpan / 2) / layout.tileSize),
			layout.gridSize,
		);
		const key = roadTileKey(layout, tileX, tileZ);
		const bucket = joinBuckets.get(key) ?? [];
		bucket.push(join);
		joinBuckets.set(key, bucket);
	}

	return {
		containsPoint(x, z) {
			const wrappedX = wrapCoordinate(x, layout.worldSpan);
			const wrappedZ = wrapCoordinate(z, layout.worldSpan);
			const tileX = Math.floor((wrappedX + layout.worldSpan / 2) / layout.tileSize);
			const tileZ = Math.floor((wrappedZ + layout.worldSpan / 2) / layout.tileSize);
			if (roadTiles.has(roadTileKey(layout, tileX, tileZ))) return true;

			for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
				for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
					const key = roadTileKey(
						layout,
						wrapGridIndex(tileX + offsetX, layout.gridSize),
						wrapGridIndex(tileZ + offsetZ, layout.gridSize),
					);
					const road = roads.get(key);
					if (road && roadProfileFor(road.roadClass).laneCount > 2) {
						const rectangle = roadRectangle(layout, roadTiles, road);
						const centerX = origin + (road.x + 0.5) * layout.tileSize;
						const centerZ = origin + (road.z + 0.5) * layout.tileSize;
						if (
							Math.abs(wrappedDelta(wrappedX, centerX, layout.worldSpan)) <=
								rectangle.halfWidth &&
							Math.abs(wrappedDelta(wrappedZ, centerZ, layout.worldSpan)) <=
								rectangle.halfDepth
						) {
							return true;
						}
					}
					for (const join of joinBuckets.get(key) ?? []) {
						const distanceX = wrappedDelta(wrappedX, join.x, layout.worldSpan) * join.directionX;
						const distanceZ = wrappedDelta(wrappedZ, join.z, layout.worldSpan) * join.directionZ;
						if (
							distanceX >= 0 &&
							distanceZ >= 0 &&
							distanceX * distanceX + distanceZ * distanceZ <= join.depth * join.depth
						) {
							return true;
						}
					}
				}
			}
			return false;
		},
	};
}

export function buildRoadSurface(layout: RoadLayout): RoadSurfaceData {
	const positions: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];
	const vertices = new Map<string, number>();
	const roadTiles = roadTileSet(layout);
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

	function rectangle(x0: number, x1: number, z0: number, z1: number): void {
		const bottomLeft = vertex(x0, z0);
		const topLeft = vertex(x0, z1);
		const topRight = vertex(x1, z1);
		const bottomRight = vertex(x1, z0);
		indices.push(bottomLeft, topLeft, topRight, bottomLeft, topRight, bottomRight);
	}

	for (const road of layout.roads) {
		const centerX = origin + (road.x + 0.5) * layout.tileSize;
		const centerZ = origin + (road.z + 0.5) * layout.tileSize;
		const bounds = roadRectangle(layout, roadTiles, road);
		rectangle(
			centerX - bounds.halfWidth,
			centerX + bounds.halfWidth,
			centerZ - bounds.halfDepth,
			centerZ + bounds.halfDepth,
		);
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
