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
import type { RoadLayout } from './world';

export const DEFAULT_TRAFFIC_VEHICLE_COUNT = 10;
export const MAX_TRAFFIC_VEHICLES = 24;
const TRAFFIC_RANDOM_SEED_SALT = 0x3c6ef372;

export const TRAFFIC_VEHICLE_KINDS = ['compact', 'bike', 'van', 'suv', 'truck'] as const;
export type TrafficVehicleKind = (typeof TRAFFIC_VEHICLE_KINDS)[number];

export interface TrafficVehicleState extends VehicleCrashState {
	id: number;
	kind: TrafficVehicleKind;
	x: number;
	z: number;
	heading: number;
	speed: number;
	longitudinalLoad: number;
	lateralLoad: number;
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
	cruiseSpeed: number;
	acceleration: number;
	braking: number;
	radius: number;
	mass: number;
	impactOffsetX: number;
	impactOffsetZ: number;
	impactVelocityX: number;
	impactVelocityZ: number;
	avoidanceOffset: number;
	avoidanceTargetOffset: number;
	recoverySeconds: number;
	collisionCooldown: number;
}

const DIRECTIONS: readonly Direction[] = [
	{ dx: 1, dz: 0 },
	{ dx: -1, dz: 0 },
	{ dx: 0, dz: 1 },
	{ dx: 0, dz: -1 },
];

const TRAFFIC_LAUNCH_SPEED_RATIO = 0.42;
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
const TRAFFIC_AVOIDANCE_OFFSET = 0.68;
const TRAFFIC_AVOIDANCE_RESPONSE = 5;
const TRAFFIC_AIRBORNE_CLOSING_SPEED = 5;
const TRAFFIC_AIRBORNE_LAUNCH_FACTOR = 0.22;
const PLAYER_AIRBORNE_LAUNCH_FACTOR = 0.14;
const TRAFFIC_AIR_IMPACT_DAMPING = 0.28;
const TRAFFIC_AIR_ROUTE_RETURN_STIFFNESS = 0.08;
const TRAFFIC_CONTACT_SOLVER_PASSES = 3;
const MINIMUM_IMPACT_CLOSING_SPEED = 0.25;

interface TrafficPhysicsSpec {
	acceleration: number;
	braking: number;
	radius: number;
	mass: number;
}

const TRAFFIC_PHYSICS: Readonly<Record<TrafficVehicleKind, TrafficPhysicsSpec>> = {
	bike: { acceleration: 4.8, braking: 7.2, radius: 0.58, mass: 0.26 },
	compact: { acceleration: 3.8, braking: 5.8, radius: 1.05, mass: 0.88 },
	van: { acceleration: 2.7, braking: 4.5, radius: 1.26, mass: 1.16 },
	suv: { acceleration: 3.1, braking: 5.1, radius: 1.22, mass: 1.26 },
	truck: { acceleration: 2.1, braking: 3.6, radius: 1.48, mass: 2.4 },
};

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
	const currentOffset = lateralOffset(vehicle.direction, vehicle.laneOffset);
	const nextOffset = lateralOffset(direction, vehicle.laneOffset);
	vehicle.offsetFromX = currentOffset.x;
	vehicle.offsetFromZ = currentOffset.z;
	vehicle.offsetToX = nextOffset.x;
	vehicle.offsetToZ = nextOffset.z;
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
		const physics = TRAFFIC_PHYSICS[kind];
		const laneOffset = (random() < 0.5 ? -1 : 1) * (kind === 'bike' ? 0.85 : 1.45);
		const heading = directionHeading(direction);
		const offset = lateralOffset(direction, laneOffset);
		const cruiseSpeed = 4.8 + random() * (kind === 'bike' ? 2.6 : 4.8);
		const vehicle: SimulatedVehicle = {
			state: {
				id: simulated.length,
				kind,
				x: 0,
				z: 0,
				heading,
				speed: cruiseSpeed * TRAFFIC_LAUNCH_SPEED_RATIO,
				longitudinalLoad: 0,
				lateralLoad: 0,
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
			cruiseSpeed,
			acceleration: physics.acceleration,
			braking: physics.braking,
			radius: physics.radius,
			mass: physics.mass,
			impactOffsetX: 0,
			impactOffsetZ: 0,
			impactVelocityX: 0,
			impactVelocityZ: 0,
			avoidanceOffset: 0,
			avoidanceTargetOffset: 0,
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
		const rightX = vehicle.direction.dz;
		const rightZ = -vehicle.direction.dx;
		const lookahead =
			TRAFFIC_AVOIDANCE_LOOKAHEAD + vehicle.state.speed * TRAFFIC_AVOIDANCE_TIME_HEADWAY;
		let targetSpeed = vehicle.cruiseSpeed;
		let brake = 0;
		let offset = 0;

		for (const obstacle of obstacles) {
			if (obstacle.id === vehicle.state.id) continue;
			const deltaX = wrappedDelta(obstacle.x - vehicle.state.x, layout.worldSpan);
			const deltaZ = wrappedDelta(obstacle.z - vehicle.state.z, layout.worldSpan);
			const forwardDistance = deltaX * forwardX + deltaZ * forwardZ;
			if (forwardDistance <= 0 || forwardDistance >= lookahead) continue;
			const lateralDistance = deltaX * rightX + deltaZ * rightZ;
			const safeGap = vehicle.radius + obstacle.radius + TRAFFIC_AVOIDANCE_GAP;
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
			const side =
				Math.abs(lateralDistance) > 0.08
					? -Math.sign(lateralDistance)
					: vehicle.state.id % 2 === 0
						? 1
						: -1;
			offset = side * Math.max(Math.abs(offset), TRAFFIC_AVOIDANCE_OFFSET * pressure);
		}

		return { targetSpeed, brake, offset };
	}

	function bodyFor(vehicle: SimulatedVehicle): VehicleImpactBody {
		return {
			x: vehicle.state.x,
			z: vehicle.state.z,
			velocityX: vehicle.state.velocityX,
			velocityZ: vehicle.state.velocityZ,
			radius: vehicle.radius,
			mass: vehicle.mass,
		};
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
			for (let firstIndex = 0; firstIndex < simulated.length; firstIndex += 1) {
				const first = simulated[firstIndex];
				for (let secondIndex = firstIndex + 1; secondIndex < simulated.length; secondIndex += 1) {
					const second = simulated[secondIndex];
					const collision = resolveVehicleImpact(bodyFor(first), bodyFor(second), layout.worldSpan);
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
	}

	return {
		vehicles,
		step(deltaSeconds, player) {
			const delta = Number.isFinite(deltaSeconds) ? Math.max(0, Math.min(deltaSeconds, 0.25)) : 0;
			const obstacles: Array<VehicleImpactBody & { id?: number }> = simulated.map((vehicle) => ({
				id: vehicle.state.id,
				x: vehicle.state.x,
				z: vehicle.state.z,
				velocityX: vehicle.state.velocityX,
				velocityZ: vehicle.state.velocityZ,
				radius: vehicle.radius,
				mass: vehicle.mass,
			}));
			if (player) obstacles.push({ ...player });
			for (const vehicle of simulated) {
				const previousX = vehicle.state.x;
				const previousZ = vehicle.state.z;
				const previousSpeed = vehicle.state.speed;
				const previousHeading = vehicle.state.heading;
				const airborne =
					vehicle.state.verticalOffset > 0 || vehicle.state.verticalVelocity > 0;
				const avoidance = avoidanceFor(vehicle, obstacles);
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
				const targetSpeed = airborne || vehicle.recoverySeconds > 0 ? 0 : avoidance.targetSpeed;
				const speedRate =
					targetSpeed >= vehicle.state.speed ? vehicle.acceleration : vehicle.braking;
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
					const collision = resolveVehicleImpact(playerBody, bodyFor(vehicle), layout.worldSpan);
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
