import type { RoadLayout, RoadTile } from './world';

export type RoadClass = 'local' | 'arterial';

export interface RoadProfile {
	roadClass: RoadClass;
	rank: number;
	laneCount: number;
	widthFactor: number;
	shoulderFactor: number;
}

export interface PlayerRoadSpawn {
	x: number;
	z: number;
	heading: number;
	tileX: number;
	tileZ: number;
	laneIndex: number;
	laneOffset: number;
	roadClass: RoadClass;
}

const ROAD_PROFILES: Readonly<Record<RoadClass, RoadProfile>> = {
	local: {
		roadClass: 'local',
		rank: 0,
		laneCount: 2,
		widthFactor: 1,
		shoulderFactor: 0.05,
	},
	arterial: {
		roadClass: 'arterial',
		rank: 1,
		laneCount: 4,
		widthFactor: 1.8,
		shoulderFactor: 0.06,
	},
};
const roadIndexCache = new WeakMap<RoadLayout, ReadonlyMap<number, RoadTile>>();

function wrapIndex(value: number, gridSize: number): number {
	return ((value % gridSize) + gridSize) % gridSize;
}

function roadKey(layout: RoadLayout, x: number, z: number): number {
	return wrapIndex(x, layout.gridSize) + wrapIndex(z, layout.gridSize) * layout.gridSize;
}

function tileCenter(layout: RoadLayout, index: number): number {
	return (index + 0.5) * layout.tileSize - layout.worldSpan / 2;
}

export function roadProfileFor(roadClass: RoadClass | undefined): RoadProfile {
	return ROAD_PROFILES[roadClass ?? 'local'];
}

export function roadWidth(profile: RoadProfile, tileSize: number): number {
	return profile.widthFactor * tileSize;
}

export function roadLaneWidth(profile: RoadProfile, tileSize: number): number {
	const shoulders = profile.shoulderFactor * tileSize * 2;
	return (roadWidth(profile, tileSize) - shoulders) / profile.laneCount;
}

export function lanesPerDirection(profile: RoadProfile): number {
	return Math.max(1, Math.floor(profile.laneCount / 2));
}

/**
 * Positive offsets always mean right of travel. Lane zero sits beside center;
 * higher indices move toward road edge, independent of total lane count.
 */
export function rightHandLaneOffset(
	profile: RoadProfile,
	tileSize: number,
	laneIndex: number,
): number {
	const clampedLane = Math.max(0, Math.min(lanesPerDirection(profile) - 1, laneIndex));
	return (clampedLane + 0.5) * roadLaneWidth(profile, tileSize);
}

export function roadTileAt(
	layout: RoadLayout,
	x: number,
	z: number,
): RoadTile | undefined {
	let roads = roadIndexCache.get(layout);
	if (!roads) {
		roads = new Map(layout.roads.map((road) => [roadKey(layout, road.x, road.z), road]));
		roadIndexCache.set(layout, roads);
	}
	return roads.get(roadKey(layout, x, z));
}

export function roadProfileAt(layout: RoadLayout, x: number, z: number): RoadProfile {
	return roadProfileFor(roadTileAt(layout, x, z)?.roadClass);
}

export function choosePlayerRoadSpawn(layout: RoadLayout): PlayerRoadSpawn {
	const roads = new Map(
		layout.roads.map((road) => [roadKey(layout, road.x, road.z), road] as const),
	);
	const center = layout.gridSize / 2;
	const junctions = layout.roads.filter((road) => {
		const west = roads.has(roadKey(layout, road.x - 1, road.z));
		const east = roads.has(roadKey(layout, road.x + 1, road.z));
		const north = roads.has(roadKey(layout, road.x, road.z - 1));
		const south = roads.has(roadKey(layout, road.x, road.z + 1));
		return [west, east, north, south].filter(Boolean).length >= 3;
	});
	const candidates = layout.roads
		.map((road) => {
			const west = roads.has(roadKey(layout, road.x - 1, road.z));
			const east = roads.has(roadKey(layout, road.x + 1, road.z));
			const north = roads.has(roadKey(layout, road.x, road.z - 1));
			const south = roads.has(roadKey(layout, road.x, road.z + 1));
			const horizontal = west && east && !north && !south;
			const vertical = north && south && !west && !east;
			const profile = roadProfileFor(road.roadClass);
			const directX = Math.abs(road.x - center);
			const directZ = Math.abs(road.z - center);
			const distance =
				Math.min(directX, layout.gridSize - directX) +
				Math.min(directZ, layout.gridSize - directZ);
			const junctionDistance = junctions.reduce((minimum, junction) => {
				const deltaX = Math.abs(road.x - junction.x);
				const deltaZ = Math.abs(road.z - junction.z);
				return Math.min(
					minimum,
					Math.min(deltaX, layout.gridSize - deltaX) +
						Math.min(deltaZ, layout.gridSize - deltaZ),
				);
			}, Number.POSITIVE_INFINITY);
			return { road, horizontal, vertical, profile, distance, junctionDistance };
		})
		.filter((candidate) => candidate.horizontal || candidate.vertical)
		.sort(
			(first, second) =>
				second.profile.rank - first.profile.rank ||
				first.distance - second.distance ||
				first.road.z - second.road.z ||
				first.road.x - second.road.x,
		);

	const selected =
		candidates.find((candidate) => candidate.junctionDistance >= 3) ?? candidates[0];
	if (!selected) {
		return {
			x: 0,
			z: 0,
			heading: 0,
			tileX: 0,
			tileZ: 0,
			laneIndex: 0,
			laneOffset: 0,
			roadClass: 'local',
		};
	}

	const direction = selected.horizontal ? { dx: 1, dz: 0 } : { dx: 0, dz: 1 };
	const laneIndex = lanesPerDirection(selected.profile) - 1;
	const laneOffset = rightHandLaneOffset(selected.profile, layout.tileSize, laneIndex);
	const offsetX = direction.dz * laneOffset;
	const offsetZ = -direction.dx * laneOffset;

	return {
		x: tileCenter(layout, selected.road.x) + offsetX,
		z: tileCenter(layout, selected.road.z) + offsetZ,
		heading: Math.atan2(direction.dx, direction.dz),
		tileX: selected.road.x,
		tileZ: selected.road.z,
		laneIndex,
		laneOffset,
		roadClass: selected.profile.roadClass,
	};
}
