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
	getTrafficVehicleModel,
	TRAFFIC_MODEL_IDS,
	TRAFFIC_VEHICLE_MODELS,
	TRAFFIC_VEHICLE_KINDS,
	trafficModelsForKind,
	type TrafficVehicleKind,
	type TrafficVehicleModel,
} from './traffic-vehicle-catalog';
import { toWorldSpeed, WORLD_METERS_PER_UNIT, type CollisionQuery, type TerrainQuery } from './vehicle';
import {
	stepVehicleMotion,
	type VehicleMotionInstruction,
	type VehicleMotionProfile,
} from './vehicle-motion';
import {
	lanesPerDirection,
	rightHandLaneOffset,
	roadProfileAt,
} from './road-network';
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
	/** Positive means vehicle's right-hand lane relative to heading. */
	laneOffset: number;
	/** Zero starts beside centerline; higher values move toward road edge. */
	laneIndex: number;
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
	excludedSpawnTile?: { tileX: number; tileZ: number; radius: number };
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
	plannedDirection?: Direction;
	progress: number;
	laneIndex: number;
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
	plannedDirection?: Direction;
	progress: number;
	laneIndex: number;
	laneOffset: number;
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
const TRAFFIC_IMPACT_INTENSITY_DECAY = 1.8;
const TRAFFIC_GROUND_RESTITUTION = 0.26;
const TRAFFIC_GROUND_STOP_SPEED = 0.35;
const TRAFFIC_COLLISION_COOLDOWN = 0.18;
const MAX_TRAFFIC_IMPACT_SPEED = 34;
const MAX_TRAFFIC_VERTICAL_SPEED = 10;
const TRAFFIC_DAMAGE_PER_IMPULSE = 0.025;
const TRAFFIC_AVOIDANCE_LOOKAHEAD = 3.5;
const TRAFFIC_AVOIDANCE_TIME_HEADWAY = 1.5;
const TRAFFIC_AVOIDANCE_GAP = 0.85;
const TRAFFIC_DRIVER_REACTION_SECONDS = 0.35;
const TRAFFIC_AVOIDANCE_CORRIDOR = 0.7;
const TRAFFIC_AVOIDANCE_RESPONSE = 5;
const TRAFFIC_INTERSECTION_STOP_GAP = 0.45;
const TRAFFIC_INTERSECTION_MIN_CONTROL_TILES = 2;
const TRAFFIC_AIRBORNE_CLOSING_SPEED = 5;
const TRAFFIC_AIRBORNE_LAUNCH_FACTOR = 0.22;
const PLAYER_AIRBORNE_LAUNCH_FACTOR = 0.14;
const TRAFFIC_AIR_IMPACT_DAMPING = 0.28;
const TRAFFIC_CONTACT_SOLVER_PASSES = 3;
const TRAFFIC_BROAD_PHASE_CELL_SIZE = 16;
const MINIMUM_IMPACT_CLOSING_SPEED = 0.25;
const TRAFFIC_RESTING_CONTACT_SPEED = 2;
const TRAFFIC_RESTING_LATERAL_OFFSET = 0.22;
const TRAFFIC_STATIC_RESTITUTION = 0.28;
const TRAFFIC_STATIC_ESCAPE_STEP = 0.5;
const TRAFFIC_STATIC_ESCAPE_MAX_DISTANCE = 12;
const TRAFFIC_STATIC_ESCAPE_DIRECTIONS = 12;
const TRAFFIC_TURN_PLAN_PROGRESS = 0.18;
const TRAFFIC_TURN_SPEED_FACTOR = 0.82;
const TRAFFIC_PATH_CORRECTION_LIMIT = 0.42;
const TRAFFIC_PATH_CORRECTION_RESPONSE = 1.25;
interface TrafficPhysicsSpec {
	acceleration: number;
	braking: number;
	radius: number;
	collisionOffset: number;
	mass: number;
	maxSpeed: number;
}

interface IntersectionApproach {
	id: number;
	distanceToEntry: number;
}

interface IntersectionControl {
	targetSpeed: number;
	maximumTravelDistance: number;
}

type TrafficObstacle = VehicleImpactBody & {
	id?: number;
	collisionHalfLength?: number;
	directionX?: number;
	directionZ?: number;
};

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

function spreadSpawnCandidates<T extends { tileX: number; tileZ: number }>(
	candidates: T[],
	layout: RoadLayout,
	random: () => number,
): T[] {
	const bucketCount = Math.min(4, layout.gridSize);
	const buckets = new Map<number, T[]>();
	for (const candidate of candidates) {
		const bucketX = Math.min(
			bucketCount - 1,
			Math.floor((candidate.tileX / layout.gridSize) * bucketCount),
		);
		const bucketZ = Math.min(
			bucketCount - 1,
			Math.floor((candidate.tileZ / layout.gridSize) * bucketCount),
		);
		const key = bucketX + bucketZ * bucketCount;
		const bucket = buckets.get(key) ?? [];
		bucket.push(candidate);
		buckets.set(key, bucket);
	}

	const activeBuckets = [...buckets.values()];
	for (const bucket of activeBuckets) shuffle(bucket, random);
	shuffle(activeBuckets, random);

	const spread: T[] = [];
	let depth = 0;
	while (activeBuckets.some((bucket) => depth < bucket.length)) {
		for (const bucket of activeBuckets) {
			const candidate = bucket[depth];
			if (candidate) spread.push(candidate);
		}
		depth += 1;
	}
	return spread;
}

function chooseTrafficModel(
	random: () => number,
	excludedIds: ReadonlySet<string>,
): TrafficVehicleModel {
	const available = TRAFFIC_VEHICLE_MODELS.filter((model) => !excludedIds.has(model.id));
	const choices = available.length > 0 ? available : TRAFFIC_VEHICLE_MODELS;
	const totalWeight = choices.reduce((total, model) => total + model.spawnWeight, 0);
	let pick = random() * totalWeight;
	for (const model of choices) {
		pick -= model.spawnWeight;
		if (pick <= 0) return model;
	}
	return choices[choices.length - 1];
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

function directionIndex(direction: Direction): number {
	if (direction.dx === 1) return 0;
	if (direction.dx === -1) return 1;
	if (direction.dz === 1) return 2;
	return 3;
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

function updatePosition(
	layout: RoadLayout,
	vehicle: SimulatedVehicle,
	synchronizeState = true,
): void {
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
	if (synchronizeState) {
		vehicle.state.x = wrapCoordinate(vehicle.routeX + vehicle.impactOffsetX, layout.worldSpan);
		vehicle.state.z = wrapCoordinate(vehicle.routeZ + vehicle.impactOffsetZ, layout.worldSpan);
	}
}

function aimVehicle(
	vehicle: SimulatedVehicle,
	direction: Direction,
	laneOffset: number = vehicle.laneOffset,
): void {
	const turn = shortestAngleDelta(directionHeading(vehicle.direction), directionHeading(direction));
	const currentOffset = lateralOffset(vehicle.direction, vehicle.laneOffset);
	const nextOffset = lateralOffset(direction, laneOffset);
	vehicle.offsetFromX = currentOffset.x;
	vehicle.offsetFromZ = currentOffset.z;
	vehicle.offsetToX = nextOffset.x;
	vehicle.offsetToZ = nextOffset.z;
	vehicle.laneOffset = laneOffset;
	vehicle.state.laneOffset = laneOffset;
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
	const intersectionTiles = new Set(
		[...roadTiles].filter((id) => {
			const tileX = id % layout.gridSize;
			const tileZ = Math.floor(id / layout.gridSize);
			return roadNeighbors(layout, roadTiles, tileX, tileZ).length >= 3;
		}),
	);
	const intersectionApproaches = new Map<number, { id: number; steps: number }>();
	for (const roadId of roadTiles) {
		const tileX = roadId % layout.gridSize;
		const tileZ = Math.floor(roadId / layout.gridSize);
		for (let index = 0; index < DIRECTIONS.length; index += 1) {
			const direction = DIRECTIONS[index];
			for (let steps = 1; steps <= layout.gridSize; steps += 1) {
				const nextX = wrapIndex(tileX + direction.dx * steps, layout.gridSize);
				const nextZ = wrapIndex(tileZ + direction.dz * steps, layout.gridSize);
				const nextId = tileId(layout, nextX, nextZ);
				if (!roadTiles.has(nextId)) break;
				if (!intersectionTiles.has(nextId)) continue;
				intersectionApproaches.set(roadId * DIRECTIONS.length + index, {
					id: nextId,
					steps,
				});
				break;
			}
		}
	}
	const candidates = [...roadTiles]
		.map((id) => ({
			tileX: id % layout.gridSize,
			tileZ: Math.floor(id / layout.gridSize),
		}))
		.filter((candidate) => {
			const excluded = options.excludedSpawnTile;
			return (
				!excluded ||
				distanceBetweenTiles(
					candidate.tileX,
					candidate.tileZ,
					excluded.tileX,
					excluded.tileZ,
					layout,
				) > excluded.radius
			);
		});
	const spawnCandidates = spreadSpawnCandidates(candidates, layout, random);
	const kindOrder = [...TRAFFIC_VEHICLE_KINDS];
	shuffle(kindOrder, random);
	const modelOrder: string[] = [];
	const reservedModelIds = new Set<string>();
	for (const kind of kindOrder) {
		const choices = [...trafficModelsForKind(kind)];
		shuffle(choices, random);
		const model = choices.find((candidateModel) => !reservedModelIds.has(candidateModel.id));
		if (!model) continue;
		modelOrder.push(model.id);
		reservedModelIds.add(model.id);
	}
	const remainingModelIds = TRAFFIC_MODEL_IDS.filter((id) => !reservedModelIds.has(id));
	shuffle(remainingModelIds, random);
	modelOrder.push(...remainingModelIds);
	const recentModelIds: string[] = [];
	const simulated: SimulatedVehicle[] = [];
	const intersectionReservations = new Map<number, number>();

	for (const candidate of spawnCandidates) {
		if (simulated.length >= vehicleCount) break;
		const model =
			simulated.length < modelOrder.length
				? getTrafficVehicleModel(modelOrder[simulated.length])
				: chooseTrafficModel(random, new Set(recentModelIds.slice(-6)));
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

		// Right-hand traffic: every vehicle stays to its right of the road
		// centerline. Opposing headings naturally occupy the opposite lane.
		const profile = roadProfileAt(layout, candidate.tileX, candidate.tileZ);
		const laneCount = lanesPerDirection(profile);
		const laneIndex =
			laneCount === 1
				? 0
				: (candidate.tileX + candidate.tileZ + simulated.length) % laneCount;
		const laneOffset = rightHandLaneOffset(profile, layout.tileSize, laneIndex);
		const heading = directionHeading(direction);
		const offset = lateralOffset(direction, laneOffset);
		const cruiseSpeed = toWorldSpeed(
			model.roadCruiseKph[0] + random() * (model.roadCruiseKph[1] - model.roadCruiseKph[0]),
		);
		const vehicle: SimulatedVehicle = {
			state: {
				id: simulated.length,
				kind: model.kind,
				modelId: model.id,
				x: 0,
				z: 0,
				heading,
				laneOffset,
				laneIndex,
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
			plannedDirection: undefined,
			progress: 0.08 + random() * 0.74,
			laneIndex,
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
		if (
			simulated.some(
				(other) => minimumTrafficClearance(vehicle, other) < TRAFFIC_AVOIDANCE_GAP,
			)
		) {
			continue;
		}
		simulated.push(vehicle);
		recentModelIds.push(model.id);
	}

	const vehicles = simulated.map((vehicle) => vehicle.state);

	function preparePlannedDirection(vehicle: SimulatedVehicle): void {
		if (vehicle.plannedDirection) return;
		const nextX = wrapIndex(vehicle.tileX + vehicle.direction.dx, layout.gridSize);
		const nextZ = wrapIndex(vehicle.tileZ + vehicle.direction.dz, layout.gridSize);
		vehicle.plannedDirection = chooseDirection(
			random,
			roadNeighbors(layout, roadTiles, nextX, nextZ),
			vehicle.direction,
		);
	}

	function routeHeadingFor(vehicle: SimulatedVehicle): number {
		const currentHeading = directionHeading(vehicle.direction);
		if (!vehicle.plannedDirection || vehicle.progress <= TRAFFIC_TURN_PLAN_PROGRESS) {
			return currentHeading;
		}
		const turn = shortestAngleDelta(
			currentHeading,
			directionHeading(vehicle.plannedDirection),
		);
		const turnProgress = smoothBlend(
			(vehicle.progress - TRAFFIC_TURN_PLAN_PROGRESS) /
				(1 - TRAFFIC_TURN_PLAN_PROGRESS),
		);
		return currentHeading + turn * turnProgress;
	}

	function maximumSteeringAngle(kind: TrafficVehicleKind): number {
		switch (kind) {
			case 'motorcycle':
				return 0.56;
			case 'truck':
				return 0.38;
			case 'bus':
				return 0.34;
			case 'van':
			case 'pickup':
				return 0.44;
			default:
				return 0.5;
		}
	}

	function trafficMotionProfile(
		vehicle: SimulatedVehicle,
		terrainAccelerationFactor: number,
	): VehicleMotionProfile {
		const maxSteeringAngle = maximumSteeringAngle(vehicle.model.kind);
		return {
			maxForwardSpeed: vehicle.maxSpeed,
			maxReverseSpeed: 0,
			acceleration: vehicle.acceleration * terrainAccelerationFactor,
			reverseAcceleration: 0,
			braking: vehicle.braking,
			coastDrag: vehicle.acceleration * 0.3,
			turningDrag: vehicle.braking * 0.12,
			wheelbase: vehicle.model.wheelbaseMeters / WORLD_METERS_PER_UNIT,
			maxSteeringAngle,
			steeringResponse: 2.4 * vehicle.model.turnResponse,
			maxLateralAcceleration:
				(5.2 + vehicle.model.traction * 3.2) / WORLD_METERS_PER_UNIT,
			accelerationTaper: 0.72,
			accelerationCurve: 1.55,
		};
	}

	function instructionFor(
		vehicle: SimulatedVehicle,
		targetSpeed: number,
		profile: VehicleMotionProfile,
	): VehicleMotionInstruction {
		const routeHeading = routeHeadingFor(vehicle);
		const routeDeltaX = wrappedDelta(vehicle.routeX - vehicle.state.x, layout.worldSpan);
		const routeDeltaZ = wrappedDelta(vehicle.routeZ - vehicle.state.z, layout.worldSpan);
		const lateralError =
			routeDeltaX * Math.cos(routeHeading) -
			routeDeltaZ * Math.sin(routeHeading);
		const correctionHeading = clamp(
			Math.atan2(
				lateralError * TRAFFIC_PATH_CORRECTION_RESPONSE,
				Math.max(3, vehicle.state.speed * 0.65),
			),
			-TRAFFIC_PATH_CORRECTION_LIMIT,
			TRAFFIC_PATH_CORRECTION_LIMIT,
		);
		const desiredHeading = routeHeading + correctionHeading;
		const headingError = shortestAngleDelta(vehicle.state.heading, desiredHeading);
		let controlledTargetSpeed = targetSpeed;

		if (vehicle.plannedDirection) {
			const turnAngle = Math.abs(
				shortestAngleDelta(
					directionHeading(vehicle.direction),
					directionHeading(vehicle.plannedDirection),
				),
			);
			if (turnAngle > 0.1) {
				const turnRadius =
					profile.wheelbase /
					Math.max(0.05, Math.tan(profile.maxSteeringAngle * 0.82));
				const cornerSpeed =
					Math.sqrt(profile.maxLateralAcceleration * turnRadius) *
					TRAFFIC_TURN_SPEED_FACTOR;
				controlledTargetSpeed = Math.min(controlledTargetSpeed, cornerSpeed);
			}
		}
		if (Math.abs(headingError) > 0.35) {
			controlledTargetSpeed = Math.min(
				controlledTargetSpeed,
				vehicle.cruiseSpeed *
					clamp(1 - Math.abs(headingError) / Math.PI, 0.18, 0.72),
			);
		}

		const speedTolerance = 0.08;
		return {
			drive: vehicle.state.speed < controlledTargetSpeed - speedTolerance ? 1 : 0,
			brake: vehicle.state.speed > controlledTargetSpeed + speedTolerance ? 1 : 0,
			steering: clamp(
				headingError / Math.max(0.05, profile.maxSteeringAngle * 0.72),
				-1,
				1,
			),
		};
	}

	function avoidanceFor(
		vehicle: SimulatedVehicle,
		obstacles: readonly TrafficObstacle[],
	): {
		targetSpeed: number;
		brake: number;
		offset: number;
		maximumTravelDistance: number;
	} {
		const forwardX = vehicle.direction.dx;
		const forwardZ = vehicle.direction.dz;
		const lookahead =
			TRAFFIC_AVOIDANCE_LOOKAHEAD +
			vehicle.collisionOffset +
			vehicle.state.speed * TRAFFIC_AVOIDANCE_TIME_HEADWAY;
		let targetSpeed = vehicle.cruiseSpeed;
		let brake = 0;
		let offset = 0;
		let maximumTravelDistance = Number.POSITIVE_INFINITY;

		for (const obstacle of obstacles) {
			if (obstacle.id === vehicle.state.id) continue;
			if (
				obstacle.directionX !== undefined &&
				obstacle.directionZ !== undefined &&
				obstacle.directionX * forwardX + obstacle.directionZ * forwardZ < 0.5
			) {
				continue;
			}
			const deltaX = wrappedDelta(obstacle.x - vehicle.state.x, layout.worldSpan);
			const deltaZ = wrappedDelta(obstacle.z - vehicle.state.z, layout.worldSpan);
			const forwardDistance = deltaX * forwardX + deltaZ * forwardZ;
			if (forwardDistance <= 0) continue;
			const lateralDistance = deltaX * vehicle.direction.dz + deltaZ * -vehicle.direction.dx;
			const obstacleSpeed = Math.max(
				0,
				obstacle.velocityX * forwardX + obstacle.velocityZ * forwardZ,
			);
			const closingSpeed = Math.max(0, vehicle.state.speed - obstacleSpeed);
			const predictedClosingDistance =
				closingSpeed * TRAFFIC_DRIVER_REACTION_SECONDS +
				(closingSpeed * closingSpeed) / (2 * vehicle.braking);
			const longitudinalSafeGap =
				vehicle.state.collisionHalfLength +
				(obstacle.collisionHalfLength ?? obstacle.radius) +
				TRAFFIC_AVOIDANCE_GAP +
				predictedClosingDistance;
			const obstacleLookahead = Math.max(
				lookahead,
				longitudinalSafeGap + TRAFFIC_AVOIDANCE_LOOKAHEAD,
			);
			if (forwardDistance >= obstacleLookahead) continue;
			const lateralSafeGap = vehicle.radius + obstacle.radius + TRAFFIC_AVOIDANCE_CORRIDOR;
			if (Math.abs(lateralDistance) > lateralSafeGap) continue;

			const usableDistance = Math.max(0, forwardDistance - longitudinalSafeGap);
			const availableDistance = Math.max(0.01, obstacleLookahead - longitudinalSafeGap);
			const speedFactor = clamp(usableDistance / availableDistance, 0, 1);
			const safeStoppingSpeed = Math.sqrt(
				obstacleSpeed * obstacleSpeed + 2 * vehicle.braking * usableDistance,
			);
			targetSpeed = Math.min(
				targetSpeed,
				vehicle.cruiseSpeed * speedFactor,
				obstacleSpeed + usableDistance * 1.3,
				safeStoppingSpeed,
			);
			maximumTravelDistance = Math.min(maximumTravelDistance, usableDistance);
			const pressure = 1 - speedFactor;
			brake = Math.max(brake, pressure);
		}

		return { targetSpeed, brake, offset, maximumTravelDistance };
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

	function minimumTrafficClearance(first: SimulatedVehicle, second: SimulatedVehicle): number {
		let minimum = Number.POSITIVE_INFINITY;
		for (const firstBody of capsuleBodies(first)) {
			for (const secondBody of capsuleBodies(second)) {
				const deltaX = wrappedDelta(secondBody.x - firstBody.x, layout.worldSpan);
				const deltaZ = wrappedDelta(secondBody.z - firstBody.z, layout.worldSpan);
				minimum = Math.min(
					minimum,
					Math.hypot(deltaX, deltaZ) - firstBody.radius - secondBody.radius,
				);
			}
		}
		return minimum;
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

	function nextIntersection(vehicle: SimulatedVehicle): IntersectionApproach | undefined {
		const roadId = tileId(layout, vehicle.tileX, vehicle.tileZ);
		const approach = intersectionApproaches.get(
			roadId * DIRECTIONS.length + directionIndex(vehicle.direction),
		);
		if (!approach) return undefined;
		return {
			id: approach.id,
			distanceToEntry: (approach.steps - vehicle.progress - 0.5) * layout.tileSize,
		};
	}

	function intersectionControlDistance(vehicle: SimulatedVehicle): number {
		const stoppingDistance =
			(vehicle.state.speed * vehicle.state.speed) / Math.max(0.1, 2 * vehicle.braking);
		return Math.max(
			layout.tileSize * TRAFFIC_INTERSECTION_MIN_CONTROL_TILES,
			stoppingDistance + vehicle.state.collisionHalfLength + TRAFFIC_INTERSECTION_STOP_GAP,
		);
	}

	function vehicleOverlapsIntersection(
		vehicle: SimulatedVehicle,
		intersectionId: number,
	): boolean {
		const centerX = tileCenter(layout, intersectionId % layout.gridSize);
		const centerZ = tileCenter(layout, Math.floor(intersectionId / layout.gridSize));
		const halfSize = layout.tileSize / 2;
		const forwardX = Math.sin(vehicle.state.heading);
		const forwardZ = Math.cos(vehicle.state.heading);
		const offsets =
			vehicle.collisionOffset > 0.08
				? [-vehicle.collisionOffset, 0, vehicle.collisionOffset]
				: [0];
		for (const offset of offsets) {
			const capsuleX = wrapCoordinate(vehicle.state.x + forwardX * offset, layout.worldSpan);
			const capsuleZ = wrapCoordinate(vehicle.state.z + forwardZ * offset, layout.worldSpan);
			const outsideX = Math.max(
				0,
				Math.abs(wrappedDelta(capsuleX - centerX, layout.worldSpan)) - halfSize,
			);
			const outsideZ = Math.max(
				0,
				Math.abs(wrappedDelta(capsuleZ - centerZ, layout.worldSpan)) - halfSize,
			);
			if (outsideX * outsideX + outsideZ * outsideZ <= vehicle.radius * vehicle.radius) {
				return true;
			}
		}
		return false;
	}

	function vehicleCenterInsideIntersection(
		vehicle: SimulatedVehicle,
		intersectionId: number,
	): boolean {
		const centerX = tileCenter(layout, intersectionId % layout.gridSize);
		const centerZ = tileCenter(layout, Math.floor(intersectionId / layout.gridSize));
		const halfSize = layout.tileSize / 2;
		return (
			Math.abs(wrappedDelta(vehicle.state.x - centerX, layout.worldSpan)) <= halfSize &&
			Math.abs(wrappedDelta(vehicle.state.z - centerZ, layout.worldSpan)) <= halfSize
		);
	}

	function vehicleRouteInsideIntersection(
		vehicle: SimulatedVehicle,
		intersectionId: number,
	): boolean {
		return tileId(layout, vehicle.tileX, vehicle.tileZ) === intersectionId;
	}

	function vehicleApproachesIntersection(vehicle: SimulatedVehicle, intersectionId: number): boolean {
		const approach = nextIntersection(vehicle);
		return (
			approach?.id === intersectionId &&
			approach.distanceToEntry <= intersectionControlDistance(vehicle)
		);
	}

	function ownsOrApproachesIntersection(vehicle: SimulatedVehicle, intersectionId: number): boolean {
		return (
			vehicleRouteInsideIntersection(vehicle, intersectionId) ||
			vehicleOverlapsIntersection(vehicle, intersectionId) ||
			vehicleApproachesIntersection(vehicle, intersectionId)
		);
	}

	function approachingVehicles(intersectionId: number): SimulatedVehicle[] {
		return simulated.filter(
			(vehicle) =>
				vehicleRouteInsideIntersection(vehicle, intersectionId) ||
				vehicleOverlapsIntersection(vehicle, intersectionId) ||
				vehicleApproachesIntersection(vehicle, intersectionId),
		);
	}

	function hasRightOfWayConflict(
		vehicle: SimulatedVehicle,
		intersectionId: number,
		candidates: readonly SimulatedVehicle[],
	): boolean {
		const rightApproachDx = -vehicle.direction.dz;
		const rightApproachDz = vehicle.direction.dx;
		return candidates.some(
			(other) =>
				other !== vehicle &&
				vehicleApproachesIntersection(other, intersectionId) &&
				other.direction.dx === rightApproachDx &&
				other.direction.dz === rightApproachDz,
		);
	}

	function chooseIntersectionOwner(intersectionId: number): number | undefined {
		const candidates = approachingVehicles(intersectionId);
		if (candidates.length === 0) return undefined;
		const currentOwner = intersectionReservations.get(intersectionId);
		if (currentOwner !== undefined) {
			const owner = simulated[currentOwner];
			if (
				owner &&
				(vehicleRouteInsideIntersection(owner, intersectionId) ||
					vehicleOverlapsIntersection(owner, intersectionId))
			) {
				return currentOwner;
			}
		}
		const routeOccupants = candidates.filter(
			(vehicle) => vehicleRouteInsideIntersection(vehicle, intersectionId),
		);
		if (routeOccupants.length > 0) {
			const retainedOwner = routeOccupants.find(
				(vehicle) => vehicle.state.id === currentOwner,
			);
			const owner =
				retainedOwner ??
				routeOccupants.sort((first, second) => first.state.id - second.state.id)[0];
			intersectionReservations.set(intersectionId, owner.state.id);
			return owner.state.id;
		}
		const centerOccupants = candidates.filter(
			(vehicle) => vehicleCenterInsideIntersection(vehicle, intersectionId),
		);
		if (centerOccupants.length > 0) {
			const retainedOwner = centerOccupants.find(
				(vehicle) => vehicle.state.id === currentOwner,
			);
			const owner =
				retainedOwner ??
				centerOccupants.sort((first, second) => first.state.id - second.state.id)[0];
			intersectionReservations.set(intersectionId, owner.state.id);
			return owner.state.id;
		}
		const occupants = candidates.filter(
			(vehicle) => vehicleOverlapsIntersection(vehicle, intersectionId),
		);
		if (occupants.length > 0) {
			const retainedOwner = occupants.find(
				(vehicle) => vehicle.state.id === currentOwner,
			);
			const owner =
				retainedOwner ??
				occupants.sort((first, second) => first.state.id - second.state.id)[0];
			intersectionReservations.set(intersectionId, owner.state.id);
			return owner.state.id;
		}
		if (currentOwner !== undefined) {
			const owner = simulated[currentOwner];
			if (owner && ownsOrApproachesIntersection(owner, intersectionId)) return currentOwner;
		}

		const eligible = candidates.filter(
			(vehicle) => !hasRightOfWayConflict(vehicle, intersectionId, candidates),
		);
		const ordered = (eligible.length > 0 ? eligible : candidates).sort(
			(first, second) => {
				const firstDistance = nextIntersection(first)?.distanceToEntry ?? Number.NEGATIVE_INFINITY;
				const secondDistance = nextIntersection(second)?.distanceToEntry ?? Number.NEGATIVE_INFINITY;
				return firstDistance - secondDistance || first.state.id - second.state.id;
			},
		);
		const owner = ordered[0];
		intersectionReservations.set(intersectionId, owner.state.id);
		return owner.state.id;
	}

	function pruneIntersectionReservations(): void {
		for (const [intersectionId, ownerId] of intersectionReservations) {
			const owner = simulated[ownerId];
			if (!owner || !ownsOrApproachesIntersection(owner, intersectionId)) {
				intersectionReservations.delete(intersectionId);
			}
		}
	}

	function intersectionTargetSpeed(
		vehicle: SimulatedVehicle,
		player?: VehicleImpactBody,
	): IntersectionControl | undefined {
		const approach = nextIntersection(vehicle);
		if (
			!approach ||
			approach.distanceToEntry > intersectionControlDistance(vehicle)
		) {
			return undefined;
		}
		const intersectionId = approach.id;
		const stopDistance = Math.max(
			0,
			approach.distanceToEntry -
				vehicle.state.collisionHalfLength -
				TRAFFIC_INTERSECTION_STOP_GAP,
		);
		if (player) {
			const intersectionX = tileCenter(layout, intersectionId % layout.gridSize);
			const intersectionZ = tileCenter(layout, Math.floor(intersectionId / layout.gridSize));
			const playerDistance = Math.hypot(
				wrappedDelta(player.x - intersectionX, layout.worldSpan),
				wrappedDelta(player.z - intersectionZ, layout.worldSpan),
			);
			if (playerDistance <= layout.tileSize * 0.62 + player.radius) {
				return {
					targetSpeed: Math.sqrt(2 * vehicle.braking * stopDistance),
					maximumTravelDistance: stopDistance,
				};
			}
		}
		const ownerId = chooseIntersectionOwner(intersectionId);
		const occupiedByOther = simulated.some(
			(other) =>
				other !== vehicle &&
				vehicle.direction.dx * other.direction.dx +
					vehicle.direction.dz * other.direction.dz ===
					0 &&
				vehicleOverlapsIntersection(other, intersectionId),
		);
		if (ownerId === vehicle.state.id) {
			return undefined;
		}
		if (ownerId === undefined && !occupiedByOther) {
			return undefined;
		}

		return {
			targetSpeed: Math.sqrt(2 * vehicle.braking * stopDistance),
			maximumTravelDistance: stopDistance,
		};
	}

	function snapshotRoute(vehicle: SimulatedVehicle): TrafficRouteSnapshot {
		return {
			tileX: vehicle.tileX,
			tileZ: vehicle.tileZ,
			direction: { ...vehicle.direction },
			plannedDirection: vehicle.plannedDirection
				? { ...vehicle.plannedDirection }
				: undefined,
			progress: vehicle.progress,
			laneIndex: vehicle.laneIndex,
			laneOffset: vehicle.laneOffset,
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
		vehicle.plannedDirection = snapshot.plannedDirection;
		vehicle.progress = snapshot.progress;
		vehicle.laneIndex = snapshot.laneIndex;
		vehicle.laneOffset = snapshot.laneOffset;
		vehicle.state.laneIndex = snapshot.laneIndex;
		vehicle.state.laneOffset = snapshot.laneOffset;
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

	function applyRouteAlignedSeparation(
		vehicle: SimulatedVehicle,
		impact: Pick<VehicleImpactChange, 'correctionX' | 'correctionZ'>,
	): void {
		const forwardCorrection =
			impact.correctionX * vehicle.direction.dx +
			impact.correctionZ * vehicle.direction.dz;
		const forwardOffset =
			vehicle.impactOffsetX * vehicle.direction.dx +
			vehicle.impactOffsetZ * vehicle.direction.dz;
		const lateralOffset =
			vehicle.impactOffsetX * vehicle.direction.dz -
			vehicle.impactOffsetZ * vehicle.direction.dx;
		const constrainedLateral = clamp(
			lateralOffset,
			-TRAFFIC_RESTING_LATERAL_OFFSET,
			TRAFFIC_RESTING_LATERAL_OFFSET,
		);

		vehicle.progress += (forwardOffset + forwardCorrection) / layout.tileSize;
		vehicle.impactOffsetX = vehicle.direction.dz * constrainedLateral;
		vehicle.impactOffsetZ = -vehicle.direction.dx * constrainedLateral;
		updatePosition(layout, vehicle);
	}

	function isRestingTrafficContact(
		first: SimulatedVehicle,
		second: SimulatedVehicle,
	): boolean {
		return (
			first.state.speed < TRAFFIC_RESTING_CONTACT_SPEED &&
			second.state.speed < TRAFFIC_RESTING_CONTACT_SPEED &&
			first.state.verticalOffset === 0 &&
			second.state.verticalOffset === 0 &&
			first.state.impactIntensity < 0.08 &&
			second.state.impactIntensity < 0.08
		);
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
					} else if (isRestingTrafficContact(first, second)) {
						applyRouteAlignedSeparation(first, collision.first);
						applyRouteAlignedSeparation(second, collision.second);
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
			const obstacles: TrafficObstacle[] = simulated.map((vehicle) => ({
				id: vehicle.state.id,
				x: vehicle.state.x,
				z: vehicle.state.z,
				velocityX: vehicle.state.velocityX,
				velocityZ: vehicle.state.velocityZ,
				radius: vehicle.radius,
				collisionHalfLength: vehicle.state.collisionHalfLength,
				directionX: vehicle.direction.dx,
				directionZ: vehicle.direction.dz,
				mass: vehicle.mass,
			}));
			if (player) obstacles.push({ ...player });
			for (const vehicle of simulated) {
				const previousX = vehicle.state.x;
				const previousZ = vehicle.state.z;
				const previousSpeed = vehicle.state.speed;
				const routeSnapshot = snapshotRoute(vehicle);
				const airborne =
					vehicle.state.verticalOffset > 0 || vehicle.state.verticalVelocity > 0;
				const avoidance = avoidanceFor(vehicle, obstacles);
				const intersectionControl = intersectionTargetSpeed(vehicle, player);
				if (intersectionControl) {
					avoidance.targetSpeed = Math.min(
						avoidance.targetSpeed,
						intersectionControl.targetSpeed,
					);
					avoidance.brake = Math.max(
						avoidance.brake,
						1 - intersectionControl.targetSpeed / vehicle.cruiseSpeed,
					);
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
				preparePlannedDirection(vehicle);
				const profile = trafficMotionProfile(vehicle, terrainAccelerationFactor);
				if (surface === 'meadow') profile.braking *= 0.86;
				const motion = stepVehicleMotion(
					vehicle.state,
					instructionFor(vehicle, targetSpeed, profile),
					profile,
					delta,
				);
				let routeTravelDistance = vehicle.state.speed * delta;
				const maximumRouteTravel = Math.min(
					avoidance.maximumTravelDistance,
					intersectionControl?.maximumTravelDistance ?? Number.POSITIVE_INFINITY,
				);
				if (routeTravelDistance > maximumRouteTravel) {
					routeTravelDistance = maximumRouteTravel;
					vehicle.state.speed = delta > 0 ? maximumRouteTravel / delta : 0;
				}
				vehicle.state.longitudinalLoad =
					delta > 0
						? clamp(
								(vehicle.state.speed - previousSpeed) /
									(Math.max(vehicle.acceleration, vehicle.braking) * delta),
								-1,
								1,
							)
						: 0;
				const impactDamping = Math.exp(
					-(airborne ? TRAFFIC_AIR_IMPACT_DAMPING : TRAFFIC_IMPACT_DAMPING) * delta,
				);
				vehicle.impactVelocityX *= impactDamping;
				vehicle.impactVelocityZ *= impactDamping;
				vehicle.progress += routeTravelDistance / layout.tileSize;
				while (vehicle.progress >= 1) {
					vehicle.progress -= 1;
					vehicle.tileX = wrapIndex(vehicle.tileX + vehicle.direction.dx, layout.gridSize);
					vehicle.tileZ = wrapIndex(vehicle.tileZ + vehicle.direction.dz, layout.gridSize);
					const profile = roadProfileAt(layout, vehicle.tileX, vehicle.tileZ);
					vehicle.laneIndex = Math.min(
						vehicle.laneIndex,
						lanesPerDirection(profile) - 1,
					);
					vehicle.state.laneIndex = vehicle.laneIndex;
					const laneOffset = rightHandLaneOffset(
						profile,
						layout.tileSize,
						vehicle.laneIndex,
					);
					const direction =
						vehicle.plannedDirection ??
						chooseDirection(
							random,
							roadNeighbors(layout, roadTiles, vehicle.tileX, vehicle.tileZ),
							vehicle.direction,
						);
					if (direction) aimVehicle(vehicle, direction, laneOffset);
					vehicle.plannedDirection = undefined;
				}
				updatePosition(layout, vehicle, false);
				const forwardX = Math.sin(vehicle.state.heading);
				const forwardZ = Math.cos(vehicle.state.heading);
				vehicle.state.x = wrapCoordinate(
					previousX +
						(forwardX * vehicle.state.speed + vehicle.impactVelocityX) * delta,
					layout.worldSpan,
				);
				vehicle.state.z = wrapCoordinate(
					previousZ +
						(forwardZ * vehicle.state.speed + vehicle.impactVelocityZ) * delta,
					layout.worldSpan,
				);
				vehicle.impactOffsetX = wrappedDelta(
					vehicle.state.x - vehicle.routeX,
					layout.worldSpan,
				);
				vehicle.impactOffsetZ = wrappedDelta(
					vehicle.state.z - vehicle.routeZ,
					layout.worldSpan,
				);
				const movementX = wrapCoordinate(vehicle.state.x - previousX, layout.worldSpan);
				const movementZ = wrapCoordinate(vehicle.state.z - previousZ, layout.worldSpan);
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
					clamp(motion.yawRate * (vehicle.state.speed / 72), -1, 1);
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
