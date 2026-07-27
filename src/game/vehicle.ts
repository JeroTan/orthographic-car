import {
	clampVelocityMagnitude,
	type VehicleImpactBody,
	type VehicleImpactEffect,
} from './vehicle-impact';

export type { VehicleImpactEffect } from './vehicle-impact';

export interface VehicleInput {
	accelerate: boolean;
	brake: boolean;
	left: boolean;
	right: boolean;
	handbrake?: boolean;
}

export interface VehicleState {
	x: number;
	z: number;
	heading: number;
	speed: number;
	slipAngle: number;
	longitudinalLoad: number;
	steeringAngle: number;
	lateralLoad: number;
	rearSlip: number;
	skidIntensity: number;
	verticalOffset: number;
	verticalVelocity: number;
	impactIntensity: number;
	damage: number;
}

export interface VehicleController {
	readonly state: VehicleState;
	step(deltaSeconds: number, input: VehicleInput): void;
	getCollisionBody(): VehicleImpactBody;
	applyImpact(impact: VehicleImpactEffect): void;
}

export interface CollisionQuery {
	intersectsCircle(x: number, z: number, radius: number): boolean;
}

export interface TerrainQuery {
	surfaceAt(x: number, z: number): 'road' | 'meadow';
	grassDensityAt?(x: number, z: number): number;
}

interface VehicleConfig {
	worldSpan: number;
	collision?: CollisionQuery;
	terrain?: TerrainQuery;
}

/** Porsche 911 GT2 (997) dimensions from Porsche technical data. */
export const PORSCHE_DIMENSIONS_METERS = Object.freeze({
	length: 4.469,
	width: 1.852,
});

/** Packed asset dimensions after MODEL_SCALE in porsche-model.ts. */
export const PORSCHE_MODEL_DIMENSIONS_WORLD = Object.freeze({
	length: 4.908842,
	width: 2.156494,
});

/** Physical metres represented by one packed-model world unit on each axis. */
export const PORSCHE_METERS_PER_WORLD_UNIT = Object.freeze({
	length: PORSCHE_DIMENSIONS_METERS.length / PORSCHE_MODEL_DIMENSIONS_WORLD.length,
	width: PORSCHE_DIMENSIONS_METERS.width / PORSCHE_MODEL_DIMENSIONS_WORLD.width,
});

/** Longitudinal world scale. Width scale feeds the collision footprint below. */
export const WORLD_METERS_PER_UNIT = PORSCHE_METERS_PER_WORLD_UNIT.length;
export const WORLD_SPEED_TO_KMH = WORLD_METERS_PER_UNIT * 3.6;
const WORLD_UNITS_PER_METER = 1 / WORLD_METERS_PER_UNIT;

const ROAD_ACCELERATION_MPS2 = 7.73;
const MEADOW_ACCELERATION_MPS2 = 4.74;
const BRAKING_MPS2 = 13.68;
const REVERSE_ACCELERATION_MPS2 = 6.83;
const MEADOW_REVERSE_ACCELERATION_MPS2 = 4.39;
const COAST_DRAG_MPS2 = 8.43;
const MEADOW_OVERSPEED_DRAG_MPS2 = 28.13;
const GRASS_ROLLING_DRAG_MPS2 = 3.86;
const TURNING_DRAG_MPS2 = 14.06;
const HANDBRAKE_DRAG_MPS2 = 21.08;
const IMPACT_GRAVITY_MPS2 = 22;

function worldSpeedFromKmh(speedKmh: number): number {
	return speedKmh / WORLD_SPEED_TO_KMH;
}

function worldAccelerationFromMps2(accelerationMps2: number): number {
	return accelerationMps2 * WORLD_UNITS_PER_METER;
}

const ACCELERATION = worldAccelerationFromMps2(ROAD_ACCELERATION_MPS2);
const MEADOW_ACCELERATION = worldAccelerationFromMps2(MEADOW_ACCELERATION_MPS2);
const BRAKING = worldAccelerationFromMps2(BRAKING_MPS2);
const REVERSE_ACCELERATION = worldAccelerationFromMps2(REVERSE_ACCELERATION_MPS2);
const MEADOW_REVERSE_ACCELERATION = worldAccelerationFromMps2(MEADOW_REVERSE_ACCELERATION_MPS2);
const COAST_DRAG = worldAccelerationFromMps2(COAST_DRAG_MPS2);
const MAX_SPEED = worldSpeedFromKmh(329);
const MAX_MEADOW_SPEED = worldSpeedFromKmh(177);
const MEADOW_OVERSPEED_DRAG = worldAccelerationFromMps2(MEADOW_OVERSPEED_DRAG_MPS2);
const GRASS_ROLLING_DRAG = worldAccelerationFromMps2(GRASS_ROLLING_DRAG_MPS2);
const GRASS_SPEED_DRAG = 0.12;
const MAX_REVERSE_SPEED = worldSpeedFromKmh(152);
const MAX_MEADOW_REVERSE_SPEED = worldSpeedFromKmh(89);
const STEERING_RATE = 1.8;
const MAX_STEERING_ANGLE = 0.5;
const STEERING_RESPONSE = 4.5;
const TURNING_DRAG = worldAccelerationFromMps2(TURNING_DRAG_MPS2);
const HANDBRAKE_DRAG = worldAccelerationFromMps2(HANDBRAKE_DRAG_MPS2);
const IMPACT_GRAVITY = worldAccelerationFromMps2(IMPACT_GRAVITY_MPS2);
const HANDBRAKE_YAW_BOOST = 1.65;
const ROAD_GRIP = 10;
const BRAKING_REAR_GRIP = 4.5;
const HANDBRAKE_REAR_GRIP = 1.2;
const HANDBRAKE_THROTTLE_FACTOR = 0.25;
const CAR_COLLISION_RADIUS =
	(PORSCHE_DIMENSIONS_METERS.width / WORLD_METERS_PER_UNIT) / 2 + 0.2;
const CAR_COLLISION_OFFSET = Math.max(
	0,
	PORSCHE_MODEL_DIMENSIONS_WORLD.length / 2 - CAR_COLLISION_RADIUS,
);
const COLLISION_SAMPLE_DISTANCE = CAR_COLLISION_RADIUS;
const MAX_COLLISION_SAMPLES = 6;
const SPEED_ACCELERATION_TAPER = 0.8;
const SPEED_ACCELERATION_CURVE = 1.6;
const LAUNCH_SLIP_SPEED = worldSpeedFromKmh(75.9);
const HARD_BRAKING_SPEED = worldSpeedFromKmh(101.2);
const LATERAL_LOAD_SPEED = worldSpeedFromKmh(404.8);
const PLAYER_COLLISION_RADIUS = CAR_COLLISION_RADIUS;
const PLAYER_COLLISION_MASS = 1.55;
const IMPACT_VELOCITY_DAMPING = 4.6;
const IMPACT_INTENSITY_DECAY = 1.7;
const IMPACT_GROUND_RESTITUTION = 0.28;
const IMPACT_GROUND_STOP_SPEED = worldAccelerationFromMps2(0.8);
const MAX_IMPACT_VERTICAL_SPEED = worldAccelerationFromMps2(9.5);
const MAX_IMPACT_KNOCKBACK_SPEED = worldSpeedFromKmh(145);

export function toSpeedometerKmh(longitudinalSpeed: number): number {
	return Math.round(Math.abs(longitudinalSpeed) * WORLD_SPEED_TO_KMH);
}

export function toWorldSpeed(speedKmh: number): number {
	return worldSpeedFromKmh(speedKmh);
}

const SURFACE_HANDLING = {
	road: {
		acceleration: ACCELERATION,
		maxForwardSpeed: MAX_SPEED,
		reverseAcceleration: REVERSE_ACCELERATION,
		maxReverseSpeed: MAX_REVERSE_SPEED,
	},
	meadow: {
		acceleration: MEADOW_ACCELERATION,
		maxForwardSpeed: MAX_MEADOW_SPEED,
		reverseAcceleration: MEADOW_REVERSE_ACCELERATION,
		maxReverseSpeed: MAX_MEADOW_REVERSE_SPEED,
	},
} as const;

type SurfaceHandling = (typeof SURFACE_HANDLING)[keyof typeof SURFACE_HANDLING];

function wrapCoordinate(value: number, span: number): number {
	const halfSpan = span / 2;
	return ((((value + halfSpan) % span) + span) % span) - halfSpan;
}

function coastTowardStop(speed: number, amount: number): number {
	if (speed > 0) return Math.max(0, speed - amount);
	if (speed < 0) return Math.min(0, speed + amount);
	return 0;
}

function speedAccelerationFactor(speed: number, maxForwardSpeed: number): number {
	const speedRatio = Math.max(0, Math.min(1, speed / maxForwardSpeed));
	return 1 - SPEED_ACCELERATION_TAPER * Math.pow(speedRatio, SPEED_ACCELERATION_CURVE);
}

function updateLongitudinalSpeed(
	speed: number,
	deltaSeconds: number,
	input: VehicleInput,
	handling: SurfaceHandling,
): number {
	let nextSpeed = speed;
	const driveAcceleration =
		handling.acceleration *
		speedAccelerationFactor(speed, handling.maxForwardSpeed) *
		(input.handbrake ? HANDBRAKE_THROTTLE_FACTOR : 1);

	if (input.accelerate && !input.brake) {
		nextSpeed =
			speed < 0
				? Math.min(0, speed + BRAKING * deltaSeconds)
				: speed > handling.maxForwardSpeed
					? Math.max(
							handling.maxForwardSpeed,
							speed - MEADOW_OVERSPEED_DRAG * deltaSeconds,
						)
					: Math.min(
							handling.maxForwardSpeed,
							speed + driveAcceleration * deltaSeconds,
						);
	} else if (input.brake && !input.accelerate) {
		nextSpeed =
			speed > 0
				? Math.max(0, speed - BRAKING * deltaSeconds)
				: Math.max(
						-handling.maxReverseSpeed,
						speed - handling.reverseAcceleration * deltaSeconds,
					);
	} else {
		nextSpeed = coastTowardStop(speed, COAST_DRAG * deltaSeconds);
	}

	return input.handbrake
		? coastTowardStop(nextSpeed, HANDBRAKE_DRAG * deltaSeconds)
		: nextSpeed;
}

function updateSteering(
	state: VehicleState,
	deltaSeconds: number,
	input: VehicleInput,
	handling: SurfaceHandling,
): void {
	const steering = Number(input.left) - Number(input.right);
	const targetSteeringAngle = steering * MAX_STEERING_ANGLE;
	const steeringStep = STEERING_RESPONSE * deltaSeconds;
	state.steeringAngle += Math.max(
		-steeringStep,
		Math.min(steeringStep, targetSteeringAngle - state.steeringAngle),
	);
	if (steering === 0 || state.speed === 0) return;

	const speedRatio =
		Math.abs(state.speed) /
		(state.speed > 0 ? handling.maxForwardSpeed : handling.maxReverseSpeed);
	const steeringGrip = 0.35 + 0.65 * speedRatio;
	state.heading +=
		steering *
		Math.sign(state.speed) *
		STEERING_RATE *
		steeringGrip *
		(input.handbrake ? HANDBRAKE_YAW_BOOST : 1) *
		deltaSeconds;
	state.speed = coastTowardStop(state.speed, TURNING_DRAG * speedRatio * deltaSeconds);
}

function updatePhysicsFeedback(
	state: VehicleState,
	deltaSeconds: number,
	input: VehicleInput,
	previousSpeed: number,
	previousHeading: number,
	launchSlip: number,
): void {
	state.longitudinalLoad =
		deltaSeconds > 0
			? Math.max(-1, Math.min(1, (state.speed - previousSpeed) / (BRAKING * deltaSeconds)))
			: 0;
	state.lateralLoad =
		deltaSeconds > 0
			? Math.max(
					-1,
					Math.min(
						1,
						((state.heading - previousHeading) / deltaSeconds) *
							(Math.abs(state.speed) / LATERAL_LOAD_SPEED),
					),
				)
			: 0;
	const driftSlip = input.handbrake ? Math.min(1, Math.abs(state.slipAngle) * 3) : 0;
	state.rearSlip = Math.max(0, launchSlip, driftSlip);
	const brakeSkid = input.brake && previousSpeed > 8 ? Math.max(0, -state.longitudinalLoad) : 0;
	const driftSkid = input.handbrake
		? Math.min(1, Math.abs(state.slipAngle) * 4 + Math.abs(state.lateralLoad) * 0.5)
		: 0;
	state.skidIntensity = Math.max(brakeSkid, driftSkid);
}

function collidesAt(collision: CollisionQuery, x: number, z: number, heading: number): boolean {
	const offsetX = Math.sin(heading) * CAR_COLLISION_OFFSET;
	const offsetZ = Math.cos(heading) * CAR_COLLISION_OFFSET;
	return (
		collision.intersectsCircle(x + offsetX, z + offsetZ, CAR_COLLISION_RADIUS) ||
		collision.intersectsCircle(x - offsetX, z - offsetZ, CAR_COLLISION_RADIUS)
	);
}

function collidesAlongPath(
	collision: CollisionQuery,
	startX: number,
	startZ: number,
	endX: number,
	endZ: number,
	heading: number,
	worldSpan: number,
): boolean {
	const rawDeltaX = endX - startX;
	const rawDeltaZ = endZ - startZ;
	const deltaX =
		Math.abs(rawDeltaX) > worldSpan / 2
			? rawDeltaX - Math.sign(rawDeltaX) * worldSpan
			: rawDeltaX;
	const deltaZ =
		Math.abs(rawDeltaZ) > worldSpan / 2
			? rawDeltaZ - Math.sign(rawDeltaZ) * worldSpan
			: rawDeltaZ;
	const travelDistance = Math.hypot(deltaX, deltaZ);
	const sampleCount = Math.min(
		MAX_COLLISION_SAMPLES,
		Math.max(1, Math.ceil(travelDistance / COLLISION_SAMPLE_DISTANCE)),
	);

	for (let sample = 1; sample <= sampleCount; sample += 1) {
		const progress = sample / sampleCount;
		if (
			collidesAt(
				collision,
				wrapCoordinate(startX + deltaX * progress, worldSpan),
				wrapCoordinate(startZ + deltaZ * progress, worldSpan),
				heading,
			)
		) {
			return true;
		}
	}

	return false;
}

export function createVehicleController(config: VehicleConfig): VehicleController {
	const state: VehicleState = {
		x: 0,
		z: 0,
		heading: 0,
		speed: 0,
		slipAngle: 0,
		longitudinalLoad: 0,
		steeringAngle: 0,
		lateralLoad: 0,
		rearSlip: 0,
		skidIntensity: 0,
		verticalOffset: 0,
		verticalVelocity: 0,
		impactIntensity: 0,
		damage: 0,
	};
	let velocityX = 0;
	let velocityZ = 0;
	let impactVelocityX = 0;
	let impactVelocityZ = 0;

	return {
		state,
		step(deltaSeconds, input) {
			const previousSpeed = state.speed;
			const previousHeading = state.heading;
			state.impactIntensity = Math.max(
				0,
				state.impactIntensity - IMPACT_INTENSITY_DECAY * deltaSeconds,
			);
			if (state.verticalOffset > 0 || state.verticalVelocity > 0) {
				state.verticalVelocity -= IMPACT_GRAVITY * deltaSeconds;
				state.verticalOffset += state.verticalVelocity * deltaSeconds;
				if (state.verticalOffset <= 0) {
					state.verticalOffset = 0;
					const rebound = -state.verticalVelocity * IMPACT_GROUND_RESTITUTION;
					state.verticalVelocity = rebound > IMPACT_GROUND_STOP_SPEED ? rebound : 0;
				}
			}
			const surface = config.terrain?.surfaceAt(state.x, state.z) ?? 'road';
			const handling = SURFACE_HANDLING[surface];
			state.speed = updateLongitudinalSpeed(state.speed, deltaSeconds, input, handling);
			updateSteering(state, deltaSeconds, input, handling);
			const grassDensity = Math.max(
				0,
				Math.min(1, config.terrain?.grassDensityAt?.(state.x, state.z) ?? 0),
			);
			state.speed = coastTowardStop(
				state.speed,
				grassDensity *
					(GRASS_ROLLING_DRAG + Math.abs(state.speed) * GRASS_SPEED_DRAG) *
					deltaSeconds,
			);

			const forwardX = Math.sin(state.heading);
			const forwardZ = Math.cos(state.heading);
			const rightX = Math.cos(state.heading);
			const rightZ = -Math.sin(state.heading);
			const launchSlip =
				input.accelerate && !input.brake && previousSpeed >= 0 && state.speed < LAUNCH_SLIP_SPEED
					? 1 - state.speed / LAUNCH_SLIP_SPEED
					: 0;
			const lateralVelocity = velocityX * rightX + velocityZ * rightZ;
			const poweredRearGrip = ROAD_GRIP * (1 - launchSlip * 0.45);
			const hardBraking = input.brake && !input.accelerate && previousSpeed > HARD_BRAKING_SPEED;
			const grip = input.handbrake
				? HANDBRAKE_REAR_GRIP
				: hardBraking
					? BRAKING_REAR_GRIP
					: poweredRearGrip;
			const retainedLateralVelocity = lateralVelocity * Math.max(0, 1 - grip * deltaSeconds);
			velocityX = forwardX * state.speed + rightX * retainedLateralVelocity;
			velocityZ = forwardZ * state.speed + rightZ * retainedLateralVelocity;
			const impactDamping = Math.exp(-IMPACT_VELOCITY_DAMPING * deltaSeconds);
			impactVelocityX *= impactDamping;
			impactVelocityZ *= impactDamping;
			state.slipAngle = Math.atan2(retainedLateralVelocity, Math.max(Math.abs(state.speed), 0.01));

			const nextX = wrapCoordinate(
				state.x + (velocityX + impactVelocityX) * deltaSeconds,
				config.worldSpan,
			);
			const nextZ = wrapCoordinate(
				state.z + (velocityZ + impactVelocityZ) * deltaSeconds,
				config.worldSpan,
			);

			if (
				config.collision &&
				collidesAlongPath(
					config.collision,
					state.x,
					state.z,
					nextX,
					nextZ,
					state.heading,
					config.worldSpan,
				)
			) {
				state.speed = 0;
				state.slipAngle = 0;
				velocityX = 0;
				velocityZ = 0;
			} else {
				state.x = nextX;
				state.z = nextZ;
			}

			updatePhysicsFeedback(
				state,
				deltaSeconds,
				input,
				previousSpeed,
				previousHeading,
				launchSlip,
			);
		},
		getCollisionBody() {
			return {
				x: state.x,
				z: state.z,
				velocityX: velocityX + impactVelocityX,
				velocityZ: velocityZ + impactVelocityZ,
				radius: PLAYER_COLLISION_RADIUS,
				mass: PLAYER_COLLISION_MASS,
			};
		},
		applyImpact(impact) {
			state.x = wrapCoordinate(state.x + impact.correctionX, config.worldSpan);
			state.z = wrapCoordinate(state.z + impact.correctionZ, config.worldSpan);
			const forwardX = Math.sin(state.heading);
			const forwardZ = Math.cos(state.heading);
			const rightX = Math.cos(state.heading);
			const rightZ = -Math.sin(state.heading);
			const existingLateralVelocity = velocityX * rightX + velocityZ * rightZ;
			const longitudinalImpact = impact.velocityX * forwardX + impact.velocityZ * forwardZ;
			const lateralImpactX = impact.velocityX - forwardX * longitudinalImpact;
			const lateralImpactZ = impact.velocityZ - forwardZ * longitudinalImpact;
			state.speed = Math.max(
				-MAX_REVERSE_SPEED,
				Math.min(MAX_SPEED, state.speed + longitudinalImpact),
			);
			velocityX = forwardX * state.speed + rightX * existingLateralVelocity;
			velocityZ = forwardZ * state.speed + rightZ * existingLateralVelocity;
			const knockback = clampVelocityMagnitude(
				impactVelocityX + lateralImpactX,
				impactVelocityZ + lateralImpactZ,
				MAX_IMPACT_KNOCKBACK_SPEED,
			);
			impactVelocityX = knockback.x;
			impactVelocityZ = knockback.z;
			state.verticalVelocity = Math.max(
				state.verticalVelocity,
				Math.min(MAX_IMPACT_VERTICAL_SPEED, impact.verticalVelocity),
			);
			state.impactIntensity = Math.max(0, Math.min(1, Math.max(state.impactIntensity, impact.intensity)));
			state.damage = Math.min(
				1,
				state.damage + Math.max(0, Math.min(1, impact.damage ?? impact.intensity * 0.4)),
			);
		},
	};
}
