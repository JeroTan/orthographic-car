import type { RoadLayout } from './world';

export const DEFAULT_TRAFFIC_VEHICLE_COUNT = 10;
export const MAX_TRAFFIC_VEHICLES = 24;
const TRAFFIC_RANDOM_SEED_SALT = 0x3c6ef372;

export const TRAFFIC_VEHICLE_KINDS = ['compact', 'bike', 'van', 'suv', 'truck'] as const;
export type TrafficVehicleKind = (typeof TRAFFIC_VEHICLE_KINDS)[number];

export interface TrafficVehicleState {
	id: number;
	kind: TrafficVehicleKind;
	x: number;
	z: number;
	heading: number;
	speed: number;
}

export interface TrafficSimulationOptions {
	layout: RoadLayout;
	seed: number;
	maxVehicles?: number;
}

export interface TrafficSimulation {
	readonly vehicles: readonly TrafficVehicleState[];
	step(deltaSeconds: number): void;
}

interface Direction {
	dx: -1 | 0 | 1;
	dz: -1 | 0 | 1;
}

interface SimulatedVehicle {
	state: TrafficVehicleState;
	tileX: number;
	tileZ: number;
	direction: Direction;
	progress: number;
	laneOffset: number;
	offsetFromX: number;
	offsetFromZ: number;
	offsetToX: number;
	offsetToZ: number;
	headingFrom: number;
	headingTo: number;
}

const DIRECTIONS: readonly Direction[] = [
	{ dx: 1, dz: 0 },
	{ dx: -1, dz: 0 },
	{ dx: 0, dz: 1 },
	{ dx: 0, dz: -1 },
];

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

function wrapIndex(value: number, size: number): number {
	return ((value % size) + size) % size;
}

function wrapCoordinate(value: number, span: number): number {
	const halfSpan = span / 2;
	return ((((value + halfSpan) % span) + span) % span) - halfSpan;
}

function tileId(layout: RoadLayout, x: number, z: number): number {
	return wrapIndex(z, layout.gridSize) * layout.gridSize + wrapIndex(x, layout.gridSize);
}

function tileCenter(layout: RoadLayout, index: number): number {
	return (index + 0.5) * layout.tileSize - layout.worldSpan / 2;
}

function roadNeighbors(
	layout: RoadLayout,
	roadTiles: ReadonlySet<number>,
	tileX: number,
	tileZ: number,
): Direction[] {
	return DIRECTIONS.filter((direction) =>
		roadTiles.has(tileId(layout, tileX + direction.dx, tileZ + direction.dz)),
	);
}

function isOpposite(first: Direction, second: Direction): boolean {
	return first.dx === -second.dx && first.dz === -second.dz;
}

function chooseDirection(
	random: () => number,
	neighbors: readonly Direction[],
	current?: Direction,
): Direction | undefined {
	if (neighbors.length === 0) return undefined;
	if (!current) return neighbors[Math.floor(random() * neighbors.length)];

	const forwardOptions = neighbors.filter((direction) => !isOpposite(direction, current));
	const options = forwardOptions.length > 0 ? forwardOptions : neighbors;
	const straight = options.find(
		(direction) => direction.dx === current.dx && direction.dz === current.dz,
	);
	if (straight && random() < 0.62) return straight;
	return options[Math.floor(random() * options.length)];
}

function shuffle<T>(values: T[], random: () => number): void {
	for (let index = values.length - 1; index > 0; index -= 1) {
		const swapIndex = Math.floor(random() * (index + 1));
		[values[index], values[swapIndex]] = [values[swapIndex], values[index]];
	}
}

function distanceBetweenTiles(
	firstX: number,
	firstZ: number,
	secondX: number,
	secondZ: number,
	layout: RoadLayout,
): number {
	const directX = Math.abs(firstX - secondX);
	const directZ = Math.abs(firstZ - secondZ);
	return Math.min(directX, layout.gridSize - directX) + Math.min(directZ, layout.gridSize - directZ);
}

function directionHeading(direction: Direction): number {
	return Math.atan2(direction.dx, direction.dz);
}

function lateralOffset(direction: Direction, laneOffset: number): { x: number; z: number } {
	return {
		x: direction.dz * laneOffset,
		z: -direction.dx * laneOffset,
	};
}

function smoothBlend(value: number): number {
	const clamped = Math.max(0, Math.min(1, value));
	return clamped * clamped * (3 - 2 * clamped);
}

function shortestAngleDelta(from: number, to: number): number {
	return ((((to - from + Math.PI) % (Math.PI * 2)) + Math.PI) % (Math.PI * 2)) - Math.PI;
}

function updatePosition(layout: RoadLayout, vehicle: SimulatedVehicle): void {
	const blend = smoothBlend(vehicle.progress);
	const headingDelta = shortestAngleDelta(vehicle.headingFrom, vehicle.headingTo);
	const centerX = tileCenter(layout, vehicle.tileX);
	const centerZ = tileCenter(layout, vehicle.tileZ);
	vehicle.state.x = wrapCoordinate(
		centerX + vehicle.direction.dx * layout.tileSize * vehicle.progress +
			vehicle.offsetFromX + (vehicle.offsetToX - vehicle.offsetFromX) * blend,
		layout.worldSpan,
	);
	vehicle.state.z = wrapCoordinate(
		centerZ + vehicle.direction.dz * layout.tileSize * vehicle.progress +
			vehicle.offsetFromZ + (vehicle.offsetToZ - vehicle.offsetFromZ) * blend,
			layout.worldSpan,
	);
	vehicle.state.heading = vehicle.headingFrom + headingDelta * blend;
}

function aimVehicle(vehicle: SimulatedVehicle, direction: Direction): void {
	const currentOffset = lateralOffset(vehicle.direction, vehicle.laneOffset);
	const nextOffset = lateralOffset(direction, vehicle.laneOffset);
	vehicle.offsetFromX = currentOffset.x;
	vehicle.offsetFromZ = currentOffset.z;
	vehicle.offsetToX = nextOffset.x;
	vehicle.offsetToZ = nextOffset.z;
	vehicle.headingFrom = vehicle.state.heading;
	vehicle.headingTo = directionHeading(direction);
	vehicle.direction = direction;
}

export function createTrafficSimulation(options: TrafficSimulationOptions): TrafficSimulation {
	const { layout } = options;
	const random = createRandom(options.seed ^ TRAFFIC_RANDOM_SEED_SALT);
	const requestedCount = options.maxVehicles ?? DEFAULT_TRAFFIC_VEHICLE_COUNT;
	const vehicleCount = Math.min(
		MAX_TRAFFIC_VEHICLES,
		Math.max(0, Number.isFinite(requestedCount) ? Math.floor(requestedCount) : DEFAULT_TRAFFIC_VEHICLE_COUNT),
	);
	const roadTiles = new Set(layout.roads.map((road) => tileId(layout, road.x, road.z)));
	const candidates = [...roadTiles].map((id) => ({
		tileX: id % layout.gridSize,
		tileZ: Math.floor(id / layout.gridSize),
	}));
	const center = layout.gridSize / 2;
	const nearby = candidates.filter(
		(candidate) =>
			distanceBetweenTiles(candidate.tileX, candidate.tileZ, center, center, layout) >= 3 &&
			distanceBetweenTiles(candidate.tileX, candidate.tileZ, center, center, layout) <= 12,
	);
	const farCandidates = candidates.filter(
		(candidate) =>
			distanceBetweenTiles(candidate.tileX, candidate.tileZ, center, center, layout) > 12,
	);
	shuffle(nearby, random);
	shuffle(farCandidates, random);
	const spawnCandidates = [...nearby, ...farCandidates];
	const kindOrder = [...TRAFFIC_VEHICLE_KINDS];
	shuffle(kindOrder, random);
	const simulated: SimulatedVehicle[] = [];

	for (const candidate of spawnCandidates) {
		if (simulated.length >= vehicleCount) break;
		if (
			simulated.some(
				(vehicle) =>
					distanceBetweenTiles(
						vehicle.tileX,
						vehicle.tileZ,
						candidate.tileX,
						candidate.tileZ,
						layout,
					) < 2
				)
		) {
			continue;
		}
		const direction = chooseDirection(
			random,
			roadNeighbors(layout, roadTiles, candidate.tileX, candidate.tileZ),
		);
		if (!direction) continue;

		const kind = kindOrder[simulated.length % kindOrder.length];
		const laneOffset = (random() < 0.5 ? -1 : 1) * (kind === 'bike' ? 0.85 : 1.45);
		const heading = directionHeading(direction);
		const offset = lateralOffset(direction, laneOffset);
		const vehicle: SimulatedVehicle = {
			state: {
				id: simulated.length,
				kind,
				x: 0,
				z: 0,
			heading,
				speed: 4.8 + random() * (kind === 'bike' ? 2.6 : 4.8),
			},
			tileX: candidate.tileX,
			tileZ: candidate.tileZ,
			direction,
			progress: 0.08 + random() * 0.74,
			laneOffset,
			offsetFromX: offset.x,
			offsetFromZ: offset.z,
			offsetToX: offset.x,
			offsetToZ: offset.z,
			headingFrom: heading,
			headingTo: heading,
		};
		updatePosition(layout, vehicle);
		simulated.push(vehicle);
	}

	const vehicles = simulated.map((vehicle) => vehicle.state);

	return {
		vehicles,
		step(deltaSeconds) {
			const delta = Number.isFinite(deltaSeconds) ? Math.max(0, Math.min(deltaSeconds, 0.25)) : 0;
			for (const vehicle of simulated) {
				vehicle.progress += (vehicle.state.speed * delta) / layout.tileSize;
				while (vehicle.progress >= 1) {
					vehicle.progress -= 1;
					vehicle.tileX = wrapIndex(vehicle.tileX + vehicle.direction.dx, layout.gridSize);
					vehicle.tileZ = wrapIndex(vehicle.tileZ + vehicle.direction.dz, layout.gridSize);
					const direction = chooseDirection(
						random,
						roadNeighbors(layout, roadTiles, vehicle.tileX, vehicle.tileZ),
						vehicle.direction,
					);
					if (direction) aimVehicle(vehicle, direction);
				}
				updatePosition(layout, vehicle);
			}
		},
	};
}
