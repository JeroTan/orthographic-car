import {
	clampVelocityMagnitude,
	resolveVehicleImpact,
	type VehicleImpactBody,
	type VehicleImpactChange,
	type VehicleImpactEffect,
} from './vehicle-impact';
import {
	applyVehicleCrashImpulse,
	createVehicleCrashState,
	stepVehicleCrashState,
	type VehicleCrashState,
} from './vehicle-crash';
import {
	chooseTrafficVehicleModel,
	TRAFFIC_VEHICLE_KINDS,
	type TrafficVehicleKind,
	type TrafficVehicleModel,
} from './traffic-vehicle-catalog';
import { toWorldSpeed, WORLD_METERS_PER_UNIT, type CollisionQuery, type TerrainQuery } from './vehicle';
import type { RoadLayout } from './world';

export const DEFAULT_TRAFFIC_VEHICLE_COUNT = 20;
export const MAX_TRAFFIC_VEHICLES = 48;
const TRAFFIC_RANDOM_SEED_SALT = 0x3c6ef372;

export { TRAFFIC_VEHICLE_KINDS, type TrafficVehicleKind } from './traffic-vehicle-catalog';

export interface TrafficVehicleState extends VehicleCrashState {
	id: number;
	kind: TrafficVehicleKind;
	modelId: string;
	x: number;
	z: number;
	heading: number;
	speed: number;
	longitudinalLoad: number;
	steeringAngle: number;
	lateralLoad: number;
	rearSlip: number;
	skidIntensity: number;
	surface: 'road' | 'meadow';
	collisionRadius: number;
	collisionHalfLength: number;
	velocityX: number;
	velocityZ: number;
	verticalOffset: number;
	verticalVelocity: number;
	impactIntensity: number;
	damage: number;
	avoidanceBrake: number;
	avoidanceOffset: number;
}

export interface TrafficPlayerImpact extends VehicleImpactEffect {
	damage: number;
}

export interface TrafficSimulationOptions {
	layout: RoadLayout;
	seed: number;
	maxVehicles?: number;
	collision?: CollisionQuery;
	terrain?: TerrainQuery;
}

export interface TrafficSimulation {
	readonly vehicles: readonly TrafficVehicleState[];
	step(deltaSeconds: number, player?: VehicleImpactBody): void;
	resolvePlayerImpacts(player: VehicleImpactBody): readonly TrafficPlayerImpact[];
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
	routeX: number;
	routeZ: number;
	model: TrafficVehicleModel;
	cruiseSpeed: number;
	maxSpeed: number;
	acceleration: number;
	braking: number;
	radius: number;
	collisionOffset: number;
	mass: number;
	impactOffsetX: number;
	impactOffsetZ: number;
	impactVelocityX: number;
	impactVelocityZ: number;
	avoidanceOffset: number;
	avoidanceTargetOffset: number;
	turnSteering: number;
	recoverySeconds: number;
	collisionCooldown: number;
}

interface TrafficRouteSnapshot {
	tileX: number;
	tileZ: number;
	direction: Direction;
	progress: number;
	offsetFromX: number;
	offsetFromZ: number;
	offsetToX: number;
	offsetToZ: number;
	impactOffsetX: number;
	impactOffsetZ: number;
}

const DIRECTIONS: readonly Direction[] = [
	{ dx: 1, dz: 0 },
	{ dx: -1, dz: 0 },
	{ dx: 0, dz: 1 },
	{ dx: 0, dz: -1 },
];

const TRAFFIC_LAUNCH_SPEED_RATIO = 0.34;
const TRAFFIC_IMPACT_GRAVITY = 22;
const TRAFFIC_IMPACT_DAMPING = 2.2;
const TRAFFIC_ROUTE_RETURN_STIFFNESS = 0.8;
const TRAFFIC_IMPACT_INTENSITY_DECAY = 1.8;
const TRAFFIC_GROUND_RESTITUTION = 0.26;
const TRAFFIC_GROUND_STOP_SPEED = 0.35;
const TRAFFIC_COLLISION_COOLDOWN = 0.18;
const MAX_TRAFFIC_IMPACT_SPEED = 34;
const MAX_TRAFFIC_VERTICAL_SPEED = 10;
const TRAFFIC_DAMAGE_PER_IMPULSE = 0.025;
const TRAFFIC_AVOIDANCE_LOOKAHEAD = 3.5;
const TRAFFIC_AVOIDANCE_TIME_HEADWAY = 1.5;
const TRAFFIC_AVOIDANCE_GAP = 0.35;
const TRAFFIC_AVOIDANCE_CORRIDOR = 0.7;
const TRAFFIC_AVOIDANCE_RESPONSE = 5;
const TRAFFIC_INTERSECTION_APPROACH_PROGRESS = 0.62;
const TRAFFIC_INTERSECTION_STOP_PROGRESS = 0.82;
const TRAFFIC_INTERSECTION_EXIT_PROGRESS = 0.68;
const TRAFFIC_AIRBORNE_CLOSING_SPEED = 5;
const TRAFFIC_AIRBORNE_LAUNCH_FACTOR = 0.22;
const PLAYER_AIRBORNE_LAUNCH_FACTOR = 0.14;
const TRAFFIC_AIR_IMPACT_DAMPING = 0.28;
const TRAFFIC_AIR_ROUTE_RETURN_STIFFNESS = 0.08;
const TRAFFIC_CONTACT_SOLVER_PASSES = 3;
const TRAFFIC_BROAD_PHASE_CELL_SIZE = 16;
const MINIMUM_IMPACT_CLOSING_SPEED = 0.25;
const TRAFFIC_STATIC_RESTITUTION = 0.28;
const TRAFFIC_STATIC_ESCAPE_STEP = 0.5;
const TRAFFIC_STATIC_ESCAPE_MAX_DISTANCE = 12;
const TRAFFIC_STATIC_ESCAPE_DIRECTIONS = 12;
const TRAFFIC_KIND_SPAWN_WEIGHTS: Readonly<Record<TrafficVehicleKind, number>> = {
	motorcycle: 6,
	compact: 11,
	civic: 8,
	suv: 6,
	pickup: 3,
	van: 4,
	truck: 2,
	bus: 1,
	supercar: 1,
};

interface TrafficPhysicsSpec {
	acceleration: number;
	braking: number;
	radius: number;
	collisionOffset: number;
	mass: number;
	maxSpeed: number;
}

function trafficPhysicsFor(model: TrafficVehicleModel): TrafficPhysicsSpec {
	const widthWorld = model.widthMeters / WORLD_METERS_PER_UNIT;
	const lengthWorld = model.lengthMeters / WORLD_METERS_PER_UNIT;
	const radius = widthWorld / 2 + 0.1;
	const collisionOffset = Math.max(0, lengthWorld / 2 - radius * 1.15);
	const zeroTo100Acceleration = toWorldSpeed(100) / model.zeroTo100Seconds;
	return {
		acceleration: zeroTo100Acceleration,
		braking: zeroTo100Acceleration * (model.kind === 'motorcycle' ? 1.45 : 1.65),
		radius,
		collisionOffset,
		mass: model.massTons,
		maxSpeed: toWorldSpeed(model.topSpeedKph),
	};
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

function wrapIndex(value: number, size: number): number {
	return ((value % size) + size) % size;
}

function wrapCoordinate(value: number, span: number): number {
	const halfSpan = span / 2;
	return ((((value + halfSpan) % span) + span) % span) - halfSpan;
}

function wrappedDelta(value: number, span: number): number {
	return wrapCoordinate(value, span);
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, value));
}

function moveToward(current: number, target: number, amount: number): number {
	if (current < target) return Math.min(target, current + amount);
	return Math.max(target, current - amount);
}

function shortestAngleDelta(from: number, to: number): number {
	return Math.atan2(Math.sin(to - from), Math.cos(to - from));
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

function chooseTrafficKind(random: () => number): TrafficVehicleKind {
	const totalWeight = TRAFFIC_VEHICLE_KINDS.reduce(
		(total, kind) => total + TRAFFIC_KIND_SPAWN_WEIGHTS[kind],
		0,
	);
	let pick = random() * totalWeight;
	for (const kind of TRAFFIC_VEHICLE_KINDS) {
		pick -= TRAFFIC_KIND_SPAWN_WEIGHTS[kind];
		if (pick <= 0) return kind;
	}
	return 'compact';
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

function updatePosition(layout: RoadLayout, vehicle: SimulatedVehicle): void {
	const blend = smoothBlend(vehicle.progress);
	const centerX = tileCenter(layout, vehicle.tileX);
	const centerZ = tileCenter(layout, vehicle.tileZ);
	const avoidanceOffset = lateralOffset(vehicle.direction, vehicle.avoidanceOffset);
	vehicle.routeX = wrapCoordinate(
		centerX + vehicle.direction.dx * layout.tileSize * vehicle.progress +
			vehicle.offsetFromX +
			(vehicle.offsetToX - vehicle.offsetFromX) * blend +
			avoidanceOffset.x,
		layout.worldSpan,
	);
	vehicle.routeZ = wrapCoordinate(
		centerZ + vehicle.direction.dz * layout.tileSize * vehicle.progress +
			vehicle.offsetFromZ +
			(vehicle.offsetToZ - vehicle.offsetFromZ) * blend +
			avoidanceOffset.z,
		layout.worldSpan,
	);
	vehicle.state.x = wrapCoordinate(vehicle.routeX + vehicle.impactOffsetX, layout.worldSpan);
	vehicle.state.z = wrapCoordinate(vehicle.routeZ + vehicle.impactOffsetZ, layout.worldSpan);
}

function aimVehicle(vehicle: SimulatedVehicle, direction: Direction): void {
	const turn = shortestAngleDelta(directionHeading(vehicle.direction), directionHeading(direction));
	const currentOffset = lateralOffset(vehicle.direction, vehicle.laneOffset);
	const nextOffset = lateralOffset(direction, vehicle.laneOffset);
	vehicle.offsetFromX = currentOffset.x;
	vehicle.offsetFromZ = currentOffset.z;
	vehicle.offsetToX = nextOffset.x;
	vehicle.offsetToZ = nextOffset.z;
	vehicle.turnSteering = clamp(turn * 0.72, -0.58, 0.58);
	vehicle.direction = direction;
}

export function createTrafficSimulation(options: TrafficSimulationOptions): TrafficSimulation {
	const { layout } = options;
	const collision = options.collision;
	const terrain = options.terrain;
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
	const intersectionReservations = new Map<number, number>();

	for (const candidate of spawnCandidates) {
		if (simulated.length >= vehicleCount) break;
		const kind =
			simulated.length < kindOrder.length
				? kindOrder[simulated.length]
				: chooseTrafficKind(random);
		const model = chooseTrafficVehicleModel(kind, random);
		const physics = trafficPhysicsFor(model);
		if (
			simulated.some(
				(vehicle) => {
					const separation =
						distanceBetweenTiles(
							vehicle.tileX,
							vehicle.tileZ,
							candidate.tileX,
							candidate.tileZ,
							layout,
						) * layout.tileSize;
					const requiredGap =
						vehicle.collisionOffset + vehicle.radius + physics.collisionOffset + physics.radius + 1;
					return separation < requiredGap;
				}
			)
		) {
			continue;
		}
		const direction = chooseDirection(
			random,
			roadNeighbors(layout, roadTiles, candidate.tileX, candidate.tileZ),
		);
		if (!direction) continue;

		const laneOffset =
			(random() < 0.5 ? -1 : 1) * (kind === 'motorcycle' ? 0.8 : model.kind === 'bus' ? 1.7 : 1.45);
		const heading = directionHeading(direction);
		const offset = lateralOffset(direction, laneOffset);
		const cruiseSpeed = toWorldSpeed(
			model.roadCruiseKph[0] + random() * (model.roadCruiseKph[1] - model.roadCruiseKph[0]),
		);
		const vehicle: SimulatedVehicle = {
			state: {
				id: simulated.length,
				kind,
				modelId: model.id,
				x: 0,
				z: 0,
				heading,
				speed: cruiseSpeed * TRAFFIC_LAUNCH_SPEED_RATIO,
				longitudinalLoad: 0,
				steeringAngle: 0,
				lateralLoad: 0,
				rearSlip: 0,
				skidIntensity: 0,
				surface: 'road',
				collisionRadius: physics.radius,
				collisionHalfLength: physics.collisionOffset + physics.radius,
				velocityX: Math.sin(heading) * cruiseSpeed * TRAFFIC_LAUNCH_SPEED_RATIO,
				velocityZ: Math.cos(heading) * cruiseSpeed * TRAFFIC_LAUNCH_SPEED_RATIO,
				verticalOffset: 0,
				verticalVelocity: 0,
				impactIntensity: 0,
				damage: 0,
				avoidanceBrake: 0,
				avoidanceOffset: 0,
				...createVehicleCrashState(),
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
			routeX: 0,
			routeZ: 0,
			model,
			cruiseSpeed,
			maxSpeed: physics.maxSpeed,
			acceleration: physics.acceleration,
			braking: physics.braking,
			radius: physics.radius,
			collisionOffset: physics.collisionOffset,
			mass: physics.mass,
			impactOffsetX: 0,
			impactOffsetZ: 0,
			impactVelocityX: 0,
			impactVelocityZ: 0,
			avoidanceOffset: 0,
			avoidanceTargetOffset: 0,
			turnSteering: 0,
			recoverySeconds: 0,
			collisionCooldown: 0,
		};
		updatePosition(layout, vehicle);
		simulated.push(vehicle);
	}

	const vehicles = simulated.map((vehicle) => vehicle.state);

	function avoidanceFor(
		vehicle: SimulatedVehicle,
		obstacles: ReadonlyArray<VehicleImpactBody & { id?: number }>,
	): { targetSpeed: number; brake: number; offset: number } {
		const forwardX = vehicle.direction.dx;
		const forwardZ = vehicle.direction.dz;
		const lookahead =
			TRAFFIC_AVOIDANCE_LOOKAHEAD +
			vehicle.collisionOffset +
			vehicle.state.speed * TRAFFIC_AVOIDANCE_TIME_HEADWAY;
		let targetSpeed = vehicle.cruiseSpeed;
		let brake = 0;
		let offset = 0;

		for (const obstacle of obstacles) {
			if (obstacle.id === vehicle.state.id) continue;
			const deltaX = wrappedDelta(obstacle.x - vehicle.state.x, layout.worldSpan);
			const deltaZ = wrappedDelta(obstacle.z - vehicle.state.z, layout.worldSpan);
			const forwardDistance = deltaX * forwardX + deltaZ * forwardZ;
			if (forwardDistance <= 0 || forwardDistance >= lookahead) continue;
			const lateralDistance = deltaX * vehicle.direction.dz + deltaZ * -vehicle.direction.dx;
			const safeGap =
				vehicle.radius + vehicle.collisionOffset + obstacle.radius + TRAFFIC_AVOIDANCE_GAP;
			if (Math.abs(lateralDistance) > safeGap + TRAFFIC_AVOIDANCE_CORRIDOR) continue;

			const usableDistance = Math.max(0, forwardDistance - safeGap);
			const availableDistance = Math.max(0.01, lookahead - safeGap);
			const speedFactor = clamp(usableDistance / availableDistance, 0, 1);
			const obstacleSpeed = Math.max(
				0,
				obstacle.velocityX * forwardX + obstacle.velocityZ * forwardZ,
			);
			targetSpeed = Math.min(
				targetSpeed,
				vehicle.cruiseSpeed * speedFactor,
				obstacleSpeed + usableDistance * 1.3,
			);
			const pressure = 1 - speedFactor;
			brake = Math.max(brake, pressure);
		}

		return { targetSpeed, brake, offset };
	}

	function capsuleBodies(vehicle: SimulatedVehicle): VehicleImpactBody[] {
		const offsets = vehicle.collisionOffset > 0.08
			? [-vehicle.collisionOffset, 0, vehicle.collisionOffset]
			: [0];
		const forwardX = Math.sin(vehicle.state.heading);
		const forwardZ = Math.cos(vehicle.state.heading);
		return offsets.map((offset) => ({
			x: wrapCoordinate(vehicle.state.x + forwardX * offset, layout.worldSpan),
			z: wrapCoordinate(vehicle.state.z + forwardZ * offset, layout.worldSpan),
			velocityX: vehicle.state.velocityX,
			velocityZ: vehicle.state.velocityZ,
			radius: vehicle.radius,
			mass: vehicle.mass,
		}));
	}

	function strongestTrafficImpact(
		first: SimulatedVehicle,
		second: SimulatedVehicle,
	): ReturnType<typeof resolveVehicleImpact> {
		let strongest: ReturnType<typeof resolveVehicleImpact>;
		for (const firstBody of capsuleBodies(first)) {
			for (const secondBody of capsuleBodies(second)) {
				const impact = resolveVehicleImpact(firstBody, secondBody, layout.worldSpan);
				if (!impact || (strongest && impact.intensity <= strongest.intensity)) continue;
				strongest = impact;
			}
		}
		return strongest;
	}

	function strongestPlayerImpact(
		player: VehicleImpactBody,
		traffic: SimulatedVehicle,
	): ReturnType<typeof resolveVehicleImpact> {
		let strongest: ReturnType<typeof resolveVehicleImpact>;
		for (const trafficBody of capsuleBodies(traffic)) {
			const impact = resolveVehicleImpact(player, trafficBody, layout.worldSpan);
			if (!impact || (strongest && impact.intensity <= strongest.intensity)) continue;
			strongest = impact;
		}
		return strongest;
	}

	function nextIntersectionId(vehicle: SimulatedVehicle): number | undefined {
		const nextX = wrapIndex(vehicle.tileX + vehicle.direction.dx, layout.gridSize);
		const nextZ = wrapIndex(vehicle.tileZ + vehicle.direction.dz, layout.gridSize);
		if (roadNeighbors(layout, roadTiles, nextX, nextZ).length < 3) return undefined;
		return tileId(layout, nextX, nextZ);
	}

	function ownsOrApproachesIntersection(vehicle: SimulatedVehicle, intersectionId: number): boolean {
		const currentId = tileId(layout, vehicle.tileX, vehicle.tileZ);
		if (currentId === intersectionId && vehicle.progress <= TRAFFIC_INTERSECTION_EXIT_PROGRESS) {
			return true;
		}
		return (
			nextIntersectionId(vehicle) === intersectionId &&
			vehicle.progress >= TRAFFIC_INTERSECTION_APPROACH_PROGRESS
		);
	}

	function pruneIntersectionReservations(): void {
		for (const [intersectionId, ownerId] of intersectionReservations) {
			const owner = simulated[ownerId];
			if (!owner || !ownsOrApproachesIntersection(owner, intersectionId)) {
				intersectionReservations.delete(intersectionId);
			}
		}
	}

	function intersectionTargetSpeed(vehicle: SimulatedVehicle): number | undefined {
		const intersectionId = nextIntersectionId(vehicle);
		if (
			intersectionId === undefined ||
			vehicle.progress < TRAFFIC_INTERSECTION_APPROACH_PROGRESS
		) {
			return undefined;
		}
		const ownerId = intersectionReservations.get(intersectionId);
		if (ownerId === undefined || ownerId === vehicle.state.id) {
			intersectionReservations.set(intersectionId, vehicle.state.id);
			return undefined;
		}

		const stopDistance = Math.max(
			0,
			(TRAFFIC_INTERSECTION_STOP_PROGRESS - vehicle.progress) * layout.tileSize,
		);
		return Math.sqrt(2 * vehicle.braking * stopDistance);
	}

	function snapshotRoute(vehicle: SimulatedVehicle): TrafficRouteSnapshot {
		return {
			tileX: vehicle.tileX,
			tileZ: vehicle.tileZ,
			direction: { ...vehicle.direction },
			progress: vehicle.progress,
			offsetFromX: vehicle.offsetFromX,
			offsetFromZ: vehicle.offsetFromZ,
			offsetToX: vehicle.offsetToX,
			offsetToZ: vehicle.offsetToZ,
			impactOffsetX: vehicle.impactOffsetX,
			impactOffsetZ: vehicle.impactOffsetZ,
		};
	}

	function restoreRoute(vehicle: SimulatedVehicle, snapshot: TrafficRouteSnapshot): void {
		vehicle.tileX = snapshot.tileX;
		vehicle.tileZ = snapshot.tileZ;
		vehicle.direction = snapshot.direction;
		vehicle.progress = snapshot.progress;
		vehicle.offsetFromX = snapshot.offsetFromX;
		vehicle.offsetFromZ = snapshot.offsetFromZ;
		vehicle.offsetToX = snapshot.offsetToX;
		vehicle.offsetToZ = snapshot.offsetToZ;
		vehicle.impactOffsetX = snapshot.impactOffsetX;
		vehicle.impactOffsetZ = snapshot.impactOffsetZ;
		updatePosition(layout, vehicle);
	}

	function staticCollisionPoint(
		vehicle: SimulatedVehicle,
		x: number = vehicle.state.x,
		z: number = vehicle.state.z,
	): { x: number; z: number } | undefined {
		if (!collision) return undefined;
		const forwardX = Math.sin(vehicle.state.heading);
		const forwardZ = Math.cos(vehicle.state.heading);
		const offsets = vehicle.collisionOffset > 0.08
			? [-vehicle.collisionOffset, 0, vehicle.collisionOffset]
			: [0];
		for (const offset of offsets) {
			const sample = {
				x: wrapCoordinate(x + forwardX * offset, layout.worldSpan),
				z: wrapCoordinate(z + forwardZ * offset, layout.worldSpan),
			};
			if (collision.intersectsCircle(sample.x, sample.z, vehicle.radius)) return sample;
		}
		return undefined;
	}

	function staticCollisionNormal(
		vehicle: SimulatedVehicle,
		velocityX: number,
		velocityZ: number,
	): { x: number; z: number } {
		const collisionPoint = staticCollisionPoint(vehicle);
		const candidate = collisionPoint
			? collision?.normalAt?.(collisionPoint.x, collisionPoint.z, vehicle.radius)
			: undefined;
		const candidateLength = candidate ? Math.hypot(candidate.x, candidate.z) : 0;
		if (candidate && Number.isFinite(candidateLength) && candidateLength > 0.0001) {
			return { x: candidate.x / candidateLength, z: candidate.z / candidateLength };
		}

		const velocityLength = Math.hypot(velocityX, velocityZ);
		if (velocityLength > 0.0001) {
			return { x: -velocityX / velocityLength, z: -velocityZ / velocityLength };
		}
		return { x: -Math.sin(vehicle.state.heading), z: -Math.cos(vehicle.state.heading) };
	}

	function findStaticEscape(vehicle: SimulatedVehicle): { x: number; z: number } | undefined {
		if (!collision || !staticCollisionPoint(vehicle)) {
			return undefined;
		}
		const normal = staticCollisionNormal(vehicle, 0, 0);
		const normalAngle = Math.atan2(normal.x, normal.z);

		for (
			let distance = TRAFFIC_STATIC_ESCAPE_STEP;
			distance <= TRAFFIC_STATIC_ESCAPE_MAX_DISTANCE;
			distance += TRAFFIC_STATIC_ESCAPE_STEP
		) {
			for (let direction = 0; direction < TRAFFIC_STATIC_ESCAPE_DIRECTIONS; direction += 1) {
				const angle = normalAngle + (direction * Math.PI * 2) / TRAFFIC_STATIC_ESCAPE_DIRECTIONS;
				const candidate = {
					x: wrapCoordinate(vehicle.state.x + Math.sin(angle) * distance, layout.worldSpan),
					z: wrapCoordinate(vehicle.state.z + Math.cos(angle) * distance, layout.worldSpan),
				};
				if (!staticCollisionPoint(vehicle, candidate.x, candidate.z)) return candidate;
			}
		}

		return undefined;
	}

	function resolveStaticCollision(
		vehicle: SimulatedVehicle,
		snapshot: TrafficRouteSnapshot,
		velocityX: number,
		velocityZ: number,
	): void {
		if (!collision) return;
		const normal = staticCollisionNormal(vehicle, velocityX, velocityZ);
		const inwardSpeed = Math.max(0, -(velocityX * normal.x + velocityZ * normal.z));
		restoreRoute(vehicle, snapshot);

		const escape = findStaticEscape(vehicle);
		if (escape) {
			vehicle.impactOffsetX = wrappedDelta(escape.x - vehicle.routeX, layout.worldSpan);
			vehicle.impactOffsetZ = wrappedDelta(escape.z - vehicle.routeZ, layout.worldSpan);
			vehicle.state.x = escape.x;
			vehicle.state.z = escape.z;
		}

		const reflectedVelocityX = velocityX + normal.x * inwardSpeed * (1 + TRAFFIC_STATIC_RESTITUTION);
		const reflectedVelocityZ = velocityZ + normal.z * inwardSpeed * (1 + TRAFFIC_STATIC_RESTITUTION);
		const recoil = clampVelocityMagnitude(
			vehicle.impactVelocityX + reflectedVelocityX,
			vehicle.impactVelocityZ + reflectedVelocityZ,
			MAX_TRAFFIC_IMPACT_SPEED,
		);
		const intensity = clamp(inwardSpeed / 18, 0, 1);
		const impulse = inwardSpeed * vehicle.mass * (1 + TRAFFIC_STATIC_RESTITUTION);

		vehicle.state.speed = 0;
		vehicle.impactVelocityX = recoil.x;
		vehicle.impactVelocityZ = recoil.z;
		vehicle.state.velocityX = recoil.x;
		vehicle.state.velocityZ = recoil.z;
		if (recoil.x !== 0 || recoil.z !== 0) {
			vehicle.state.heading = Math.atan2(recoil.x, recoil.z);
		}
		vehicle.state.verticalVelocity = Math.max(
			vehicle.state.verticalVelocity,
			airborneVelocity(inwardSpeed, TRAFFIC_AIRBORNE_LAUNCH_FACTOR),
		);
		vehicle.state.impactIntensity = Math.max(vehicle.state.impactIntensity, intensity);
		vehicle.state.damage = Math.min(1, vehicle.state.damage + damageFromImpulse(impulse));
		applyVehicleCrashImpulse(vehicle.state, {
			heading: vehicle.state.heading,
			velocityX: reflectedVelocityX - velocityX,
			velocityZ: reflectedVelocityZ - velocityZ,
			intensity,
			verticalVelocity: vehicle.state.verticalVelocity,
		});
		vehicle.recoverySeconds = Math.max(vehicle.recoverySeconds, 0.16 + intensity * 0.4);
		updatePosition(layout, vehicle);
	}

	function airborneVelocity(closingSpeed: number, factor: number): number {
		return Math.min(
			MAX_TRAFFIC_VERTICAL_SPEED,
			Math.max(0, closingSpeed - TRAFFIC_AIRBORNE_CLOSING_SPEED) * factor,
		);
	}

	function damageFromImpulse(impulse: number): number {
		return clamp(impulse * TRAFFIC_DAMAGE_PER_IMPULSE, 0, 1);
	}

	function applyTrafficSeparation(
		vehicle: SimulatedVehicle,
		impact: Pick<VehicleImpactChange, 'correctionX' | 'correctionZ'>,
	): void {
		vehicle.impactOffsetX += impact.correctionX;
		vehicle.impactOffsetZ += impact.correctionZ;
		vehicle.state.x = wrapCoordinate(vehicle.routeX + vehicle.impactOffsetX, layout.worldSpan);
		vehicle.state.z = wrapCoordinate(vehicle.routeZ + vehicle.impactOffsetZ, layout.worldSpan);
	}

	function applyTrafficImpact(
		vehicle: SimulatedVehicle,
		impact: VehicleImpactChange,
		closingSpeed: number,
		intensity: number,
		damage: number,
	): void {
		applyTrafficSeparation(vehicle, impact);
		const forwardX = Math.sin(vehicle.state.heading);
		const forwardZ = Math.cos(vehicle.state.heading);
		const longitudinalImpact = impact.velocityX * forwardX + impact.velocityZ * forwardZ;
		// Route speed cannot be negative. Keep reverse impact in transient world
		// velocity so head-on collisions recoil instead of stopping dead.
		const routeImpact = Math.max(0, longitudinalImpact);
		const recoilX = impact.velocityX - forwardX * routeImpact;
		const recoilZ = impact.velocityZ - forwardZ * routeImpact;
		vehicle.state.speed = clamp(
			vehicle.state.speed + routeImpact,
			0,
			MAX_TRAFFIC_IMPACT_SPEED,
		);
		const impactVelocity = clampVelocityMagnitude(
			vehicle.impactVelocityX + recoilX,
			vehicle.impactVelocityZ + recoilZ,
			MAX_TRAFFIC_IMPACT_SPEED,
		);
		vehicle.impactVelocityX = impactVelocity.x;
		vehicle.impactVelocityZ = impactVelocity.z;
		vehicle.state.x = wrapCoordinate(vehicle.routeX + vehicle.impactOffsetX, layout.worldSpan);
		vehicle.state.z = wrapCoordinate(vehicle.routeZ + vehicle.impactOffsetZ, layout.worldSpan);
		vehicle.state.velocityX = forwardX * vehicle.state.speed + vehicle.impactVelocityX;
		vehicle.state.velocityZ = forwardZ * vehicle.state.speed + vehicle.impactVelocityZ;
		if (vehicle.state.velocityX !== 0 || vehicle.state.velocityZ !== 0) {
			vehicle.state.heading = Math.atan2(vehicle.state.velocityX, vehicle.state.velocityZ);
		}
		vehicle.state.verticalVelocity = Math.max(
			vehicle.state.verticalVelocity,
			airborneVelocity(closingSpeed, TRAFFIC_AIRBORNE_LAUNCH_FACTOR),
		);
		vehicle.state.impactIntensity = Math.max(vehicle.state.impactIntensity, intensity);
		applyVehicleCrashImpulse(vehicle.state, {
			heading: vehicle.state.heading,
			velocityX: impact.velocityX,
			velocityZ: impact.velocityZ,
			intensity,
			verticalVelocity: vehicle.state.verticalVelocity,
		});
		vehicle.state.damage = Math.min(1, vehicle.state.damage + damage);
		vehicle.recoverySeconds = Math.max(vehicle.recoverySeconds, 0.12 + intensity * 0.3);
		vehicle.collisionCooldown = TRAFFIC_COLLISION_COOLDOWN;
	}

	function resolveTrafficImpacts(): void {
		for (let pass = 0; pass < TRAFFIC_CONTACT_SOLVER_PASSES; pass += 1) {
			for (const [first, second] of broadPhasePairs()) {
					const collision = strongestTrafficImpact(first, second);
					if (!collision) continue;
					const hasNewImpact =
						pass === 0 &&
						first.collisionCooldown <= 0 &&
						second.collisionCooldown <= 0 &&
						collision.closingSpeed >= MINIMUM_IMPACT_CLOSING_SPEED;

					if (hasNewImpact) {
						const damage = damageFromImpulse(collision.impulse);
						applyTrafficImpact(first, collision.first, collision.closingSpeed, collision.intensity, damage);
						applyTrafficImpact(second, collision.second, collision.closingSpeed, collision.intensity, damage);
					} else {
						applyTrafficSeparation(first, collision.first);
						applyTrafficSeparation(second, collision.second);
					}
			}
		}
	}

	function broadPhasePairs(): readonly (readonly [SimulatedVehicle, SimulatedVehicle])[] {
		const cellCount = Math.max(1, Math.ceil(layout.worldSpan / TRAFFIC_BROAD_PHASE_CELL_SIZE));
		const cells = new Map<number, SimulatedVehicle[]>();
		for (const vehicle of simulated) {
			const cellX = wrapIndex(
				Math.floor((vehicle.state.x + layout.worldSpan / 2) / TRAFFIC_BROAD_PHASE_CELL_SIZE),
				cellCount,
			);
			const cellZ = wrapIndex(
				Math.floor((vehicle.state.z + layout.worldSpan / 2) / TRAFFIC_BROAD_PHASE_CELL_SIZE),
				cellCount,
			);
			const cellId = cellZ * cellCount + cellX;
			const bucket = cells.get(cellId);
			if (bucket) bucket.push(vehicle);
			else cells.set(cellId, [vehicle]);
		}

		const pairs: [SimulatedVehicle, SimulatedVehicle][] = [];
		const seen = new Set<string>();
		for (const vehicle of simulated) {
			const cellX = wrapIndex(
				Math.floor((vehicle.state.x + layout.worldSpan / 2) / TRAFFIC_BROAD_PHASE_CELL_SIZE),
				cellCount,
			);
			const cellZ = wrapIndex(
				Math.floor((vehicle.state.z + layout.worldSpan / 2) / TRAFFIC_BROAD_PHASE_CELL_SIZE),
				cellCount,
			);
			for (let deltaZ = -1; deltaZ <= 1; deltaZ += 1) {
				for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
					const neighbor = cells.get(
						wrapIndex(cellZ + deltaZ, cellCount) * cellCount +
							wrapIndex(cellX + deltaX, cellCount),
					);
					if (!neighbor) continue;
					for (const candidate of neighbor) {
						if (candidate === vehicle) continue;
						const first = vehicle.state.id < candidate.state.id ? vehicle : candidate;
						const second = first === vehicle ? candidate : vehicle;
						const key = `${first.state.id}:${second.state.id}`;
						if (seen.has(key)) continue;
						seen.add(key);
						pairs.push([first, second]);
					}
				}
			}
		}
		return pairs;
	}

	return {
		vehicles,
		step(deltaSeconds, player) {
			const delta = Number.isFinite(deltaSeconds) ? Math.max(0, Math.min(deltaSeconds, 0.25)) : 0;
			pruneIntersectionReservations();
			const obstacles: Array<VehicleImpactBody & { id?: number }> = simulated.map((vehicle) => ({
				id: vehicle.state.id,
				x: vehicle.state.x,
				z: vehicle.state.z,
				velocityX: vehicle.state.velocityX,
				velocityZ: vehicle.state.velocityZ,
				radius: vehicle.radius + vehicle.collisionOffset,
				mass: vehicle.mass,
			}));
			if (player) obstacles.push({ ...player });
			for (const vehicle of simulated) {
				const previousX = vehicle.state.x;
				const previousZ = vehicle.state.z;
				const previousSpeed = vehicle.state.speed;
				const previousHeading = vehicle.state.heading;
				const routeSnapshot = snapshotRoute(vehicle);
				const airborne =
					vehicle.state.verticalOffset > 0 || vehicle.state.verticalVelocity > 0;
				const avoidance = avoidanceFor(vehicle, obstacles);
				const intersectionSpeed = intersectionTargetSpeed(vehicle);
				if (intersectionSpeed !== undefined) {
					avoidance.targetSpeed = Math.min(avoidance.targetSpeed, intersectionSpeed);
					avoidance.brake = Math.max(avoidance.brake, 1 - intersectionSpeed / vehicle.cruiseSpeed);
				}
				vehicle.avoidanceTargetOffset = avoidance.offset;
				const avoidanceResponse = 1 - Math.exp(-TRAFFIC_AVOIDANCE_RESPONSE * delta);
				vehicle.avoidanceOffset +=
					(vehicle.avoidanceTargetOffset - vehicle.avoidanceOffset) * avoidanceResponse;
				vehicle.state.avoidanceOffset = vehicle.avoidanceOffset;
				vehicle.state.avoidanceBrake = avoidance.brake;
				vehicle.collisionCooldown = Math.max(0, vehicle.collisionCooldown - delta);
				vehicle.recoverySeconds = Math.max(0, vehicle.recoverySeconds - delta);
				vehicle.state.impactIntensity = Math.max(
					0,
					vehicle.state.impactIntensity - TRAFFIC_IMPACT_INTENSITY_DECAY * delta,
				);
				if (airborne) {
					vehicle.state.verticalVelocity -= TRAFFIC_IMPACT_GRAVITY * delta;
					vehicle.state.verticalOffset += vehicle.state.verticalVelocity * delta;
					if (vehicle.state.verticalOffset <= 0) {
						vehicle.state.verticalOffset = 0;
						const rebound = -vehicle.state.verticalVelocity * TRAFFIC_GROUND_RESTITUTION;
						vehicle.state.verticalVelocity = rebound > TRAFFIC_GROUND_STOP_SPEED ? rebound : 0;
					}
				}
				stepVehicleCrashState(vehicle.state, delta, airborne);
				const surface = terrain?.surfaceAt(vehicle.state.x, vehicle.state.z) ?? 'road';
				vehicle.state.surface = surface;
				const terrainSpeedFactor = surface === 'meadow' ? 0.46 + vehicle.model.traction * 0.12 : 1;
				const terrainAccelerationFactor = surface === 'meadow' ? 0.48 + vehicle.model.traction * 0.18 : 1;
				const targetSpeed =
					airborne || vehicle.recoverySeconds > 0
						? 0
						: Math.min(avoidance.targetSpeed, vehicle.cruiseSpeed * terrainSpeedFactor);
				const topSpeedRatio = clamp(vehicle.state.speed / vehicle.maxSpeed, 0, 1);
				const accelerationTaper = 1 - 0.72 * Math.pow(topSpeedRatio, 1.55);
				const accelerating = targetSpeed >= vehicle.state.speed;
				const speedRate = accelerating
					? vehicle.acceleration * accelerationTaper * terrainAccelerationFactor
					: vehicle.braking * (surface === 'meadow' ? 0.86 : 1);
				vehicle.state.speed = moveToward(
					vehicle.state.speed,
					targetSpeed,
					speedRate * delta,
				);
				vehicle.state.longitudinalLoad =
					delta > 0
						? Math.max(
								-1,
								Math.min(
									1,
									(vehicle.state.speed - previousSpeed) / (speedRate * delta),
								),
							)
						: 0;
				const routeReturnStiffness = airborne
					? TRAFFIC_AIR_ROUTE_RETURN_STIFFNESS
					: TRAFFIC_ROUTE_RETURN_STIFFNESS;
				vehicle.impactVelocityX -= vehicle.impactOffsetX * routeReturnStiffness * delta;
				vehicle.impactVelocityZ -= vehicle.impactOffsetZ * routeReturnStiffness * delta;
				const impactDamping = Math.exp(
					-(airborne ? TRAFFIC_AIR_IMPACT_DAMPING : TRAFFIC_IMPACT_DAMPING) * delta,
				);
				vehicle.impactVelocityX *= impactDamping;
				vehicle.impactVelocityZ *= impactDamping;
				vehicle.impactOffsetX += vehicle.impactVelocityX * delta;
				vehicle.impactOffsetZ += vehicle.impactVelocityZ * delta;
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
				const movementX = wrapCoordinate(vehicle.state.x - previousX, layout.worldSpan);
				const movementZ = wrapCoordinate(vehicle.state.z - previousZ, layout.worldSpan);
				if (movementX !== 0 || movementZ !== 0) {
					vehicle.state.heading = Math.atan2(movementX, movementZ);
				}
				vehicle.state.velocityX = delta > 0 ? movementX / delta : vehicle.state.velocityX;
				vehicle.state.velocityZ = delta > 0 ? movementZ / delta : vehicle.state.velocityZ;
				if (staticCollisionPoint(vehicle)) {
					resolveStaticCollision(
						vehicle,
						routeSnapshot,
						delta > 0 ? movementX / delta : vehicle.state.velocityX,
						delta > 0 ? movementZ / delta : vehicle.state.velocityZ,
					);
				}
				vehicle.state.lateralLoad =
					delta > 0
						? Math.max(
								-1,
								Math.min(
									1,
									(shortestAngleDelta(previousHeading, vehicle.state.heading) / delta) *
										(vehicle.state.speed / 72),
								),
							)
						: 0;
				const routeTurn = vehicle.turnSteering * clamp(1 - vehicle.progress / 0.52, 0, 1);
				const steeringTarget = clamp(
					routeTurn + vehicle.state.lateralLoad * 0.48 * vehicle.model.turnResponse,
					-0.58,
					0.58,
				);
				const steeringResponse = 1 - Math.exp(-7 * delta);
				vehicle.state.steeringAngle +=
					(steeringTarget - vehicle.state.steeringAngle) * steeringResponse;
				const movementRatio = clamp(vehicle.state.speed / Math.max(0.01, vehicle.cruiseSpeed), 0, 1);
				vehicle.state.rearSlip = clamp(
					Math.abs(vehicle.state.lateralLoad) * movementRatio * (1.2 - vehicle.model.traction) +
						vehicle.state.impactIntensity * 0.55,
					0,
					1,
				);
				vehicle.state.skidIntensity = clamp(
					Math.max(
						vehicle.state.rearSlip,
						vehicle.state.avoidanceBrake * movementRatio * 0.9,
						vehicle.state.impactIntensity * 0.72,
					),
					0,
					1,
				);
			}
			resolveTrafficImpacts();
		},
		resolvePlayerImpacts(player) {
			const playerBody = { ...player };
			const playerImpact: TrafficPlayerImpact = {
				velocityX: 0,
				velocityZ: 0,
				correctionX: 0,
				correctionZ: 0,
				verticalVelocity: 0,
				intensity: 0,
				damage: 0,
			};
			let contacted = false;

			for (let pass = 0; pass < TRAFFIC_CONTACT_SOLVER_PASSES; pass += 1) {
				for (const vehicle of simulated) {
					const collision = strongestPlayerImpact(playerBody, vehicle);
					if (!collision) continue;
					contacted = true;
					const hasNewImpact =
						pass === 0 &&
						vehicle.collisionCooldown <= 0 &&
						collision.closingSpeed >= MINIMUM_IMPACT_CLOSING_SPEED;

					if (hasNewImpact) {
						const damage = damageFromImpulse(collision.impulse);
						applyTrafficImpact(
							vehicle,
							collision.second,
							collision.closingSpeed,
							collision.intensity,
							damage,
						);
						playerBody.velocityX += collision.first.velocityX;
						playerBody.velocityZ += collision.first.velocityZ;
						playerImpact.velocityX += collision.first.velocityX;
						playerImpact.velocityZ += collision.first.velocityZ;
						playerImpact.verticalVelocity = Math.max(
							playerImpact.verticalVelocity,
							airborneVelocity(collision.closingSpeed, PLAYER_AIRBORNE_LAUNCH_FACTOR),
						);
						playerImpact.intensity = Math.max(playerImpact.intensity, collision.intensity);
						playerImpact.damage = Math.min(1, playerImpact.damage + damage);
					} else {
						applyTrafficSeparation(vehicle, collision.second);
					}

					playerBody.x = wrapCoordinate(
						playerBody.x + collision.first.correctionX,
						layout.worldSpan,
					);
					playerBody.z = wrapCoordinate(
						playerBody.z + collision.first.correctionZ,
						layout.worldSpan,
					);
					playerImpact.correctionX += collision.first.correctionX;
					playerImpact.correctionZ += collision.first.correctionZ;
				}
			}

			return contacted ? [playerImpact] : [];
		},
	};
}
